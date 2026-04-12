#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(v|r)\d+\b/g, ' ')
    .replace(/\bbaseline\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

function titleCase(text) {
  return String(text || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function loadFirstExisting(paths) {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function stripEditorialRecommendations(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  delete obj.editorial_recommendations;
  delete obj.editorialRecommendations;
  delete obj.recommendations;
  if (obj.sections && typeof obj.sections === 'object') {
    delete obj.sections.editorial_recommendations;
    delete obj.sections.editorialRecommendations;
    delete obj.sections.recommendations;
  }
  return obj;
}

function normalizeDefaults(payload) {
  payload.audience = 'marketing';
  payload.tone = 'detailed';
  payload.preset = 'marketing_activity_30d';
  payload.defaults = {
    ...(payload.defaults || {}),
    audience: 'marketing',
    tone: 'detailed',
    preset: 'marketing_activity_30d',
    window: '30d',
  };
  return payload;
}

function extractWeeklyRecords(payload) {
  const candidates = [
    payload.weekly_activity_log,
    payload.weeklyActivityLog,
    payload.sections && payload.sections.weekly_activity_log,
    payload.sections && payload.sections.weeklyActivityLog,
    payload.sections && payload.sections.weekly_log,
    payload.sections && payload.sections.weeklyLog,
    payload.weeks,
    payload.weekly,
    payload.activity_log,
    payload.activityLog,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }
  return [];
}

function collectConceptNamesFromWeek(week) {
  const names = [];
  const groups = week.content_groups || week.contentGroups || week.groups || {};
  const groupKeys = [
    'findings',
    'testing_concepts',
    'testingConcepts',
    'in_process',
    'inProcess',
    'weekly_progress',
    'weeklyProgress',
    'next_steps',
    'nextSteps',
  ];
  for (const key of groupKeys) {
    const items = groups[key];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item) continue;
      if (typeof item === 'string') {
        names.push(item);
      } else if (typeof item.text === 'string') {
        names.push(item.text);
      } else if (typeof item.title === 'string') {
        names.push(item.title);
      }
      if (Array.isArray(item.children)) {
        for (const child of item.children) {
          if (child && typeof child.text === 'string') names.push(child.text);
        }
      }
    }
  }
  return names
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .filter((s) => !/^view\b/i.test(s))
    .filter((s) => !/^\p{Emoji}/u.test(s));
}

function summarizeWeek(week) {
  const weekDate = week.week_date || week.weekDate || week.date || '';
  const label = week.week_label_raw || week.weekLabelRaw || weekDate;
  const names = collectConceptNamesFromWeek(week);
  const grouped = new Map();
  for (const name of names) {
    const base = slugify(name);
    if (!base) continue;
    if (!grouped.has(base)) grouped.set(base, new Set());
    grouped.get(base).add(name);
  }
  const groups = [];
  for (const [, set] of grouped.entries()) {
    const variants = Array.from(set);
    variants.sort((a, b) => a.length - b.length || a.localeCompare(b));
    const canonical = variants[0];
    groups.push({
      label: canonical,
      variants,
    });
  }
  groups.sort((a, b) => a.label.localeCompare(b.label));

  return {
    week_date: weekDate,
    week_label: label,
    concept_count: groups.length,
    concepts: groups,
  };
}

function buildRepeatedThreads(weeks) {
  const threadMap = new Map();
  for (const week of weeks) {
    const summary = summarizeWeek(week);
    for (const concept of summary.concepts) {
      const key = slugify(concept.label);
      if (!key) continue;
      if (!threadMap.has(key)) {
        threadMap.set(key, {
          key,
          name: titleCase(key.replace(/-/g, ' ')),
          weeks_seen: new Set(),
          variants: new Set(),
        });
      }
      const entry = threadMap.get(key);
      entry.weeks_seen.add(summary.week_label || summary.week_date);
      concept.variants.forEach((v) => entry.variants.add(v));
    }
  }
  return Array.from(threadMap.values())
    .map((entry) => ({
      name: entry.name,
      weeks_seen_count: entry.weeks_seen.size,
      examples: Array.from(entry.variants).slice(0, 3),
    }))
    .sort((a, b) => b.weeks_seen_count - a.weeks_seen_count || a.name.localeCompare(b.name))
    .slice(0, 8);
}

function deriveSnapshot(payload, weeks, deckSummary) {
  const linkedDecks = payload.deck_count || payload.linked_deck_count || payload.linkedDeckCount || (payload.snapshot && payload.snapshot.linked_decks_in_window) || 0;
  const ingestedDecks = (deckSummary && (deckSummary.ingested_pdf_count || deckSummary.deck_content_count || deckSummary.ingestedDeckCount))
    || payload.deck_content_count
    || payload.decks_with_ingested_text
    || (payload.snapshot && payload.snapshot.decks_with_ingested_text_available)
    || 0;
  const trackedItems = payload.record_count || payload.item_count || payload.tracked_item_count || payload.trackedItems || 0;
  return {
    window: '30d',
    weekly_updates: weeks.length,
    tracked_items: trackedItems,
    linked_decks_in_window: linkedDecks,
    decks_with_ingested_text_available: ingestedDecks,
  };
}

function pickActiveWorkstreams(threads) {
  return threads.slice(0, 6).map((thread) => ({
    name: thread.name,
    unresolved_question: thread.weeks_seen_count > 1
      ? `How should this thread be narrowed into a clearer next experiment or rollout decision?`
      : `What does this line of work need to prove in the next round of research?`,
    recent_examples: thread.examples,
  }));
}

function pickComparisonWork(weeks) {
  const items = [];
  for (const week of weeks) {
    for (const name of collectConceptNamesFromWeek(week)) {
      if (/\b(v\d+|r\d+|baseline|variation|compare|comparison)\b/i.test(name)) {
        items.push({ week: week.week_label_raw || week.week_date, label: name });
      }
    }
  }
  const dedup = new Map();
  for (const item of items) {
    const key = slugify(item.label);
    if (!dedup.has(key)) dedup.set(key, { name: item.label, weeks: new Set() });
    dedup.get(key).weeks.add(item.week);
  }
  return Array.from(dedup.values()).map((v) => ({
    name: v.name,
    weeks_seen: Array.from(v.weeks),
  })).slice(0, 8);
}

function buildHowToUseThisLog() {
  return [
    'Use this page to show cadence and volume across the last 30 days, not to make ship / hold calls.',
    'Treat repeated threads as signs of where research capacity is concentrating.',
    'Use linked decks and ingested text to drill into individual findings when a workstream needs more detail.',
  ];
}

function buildMarkdown(payload) {
  const lines = [];
  lines.push(`# ${payload.title}`);
  lines.push('');
  lines.push(payload.summary);
  lines.push('');
  lines.push('## Snapshot');
  lines.push('');
  lines.push(`- Weekly updates: ${payload.snapshot.weekly_updates}`);
  lines.push(`- Tracked items: ${payload.snapshot.tracked_items}`);
  lines.push(`- Linked decks in 30d window: ${payload.snapshot.linked_decks_in_window}`);
  lines.push(`- Decks with ingested text available: ${payload.snapshot.decks_with_ingested_text_available}`);
  lines.push('');
  lines.push('## Weekly activity log');
  lines.push('');
  for (const week of payload.weekly_activity_log) {
    lines.push(`### ${week.week_label}`);
    lines.push(`- Concepts touched: ${week.concept_count}`);
    for (const concept of week.concepts) {
      if (concept.variants.length > 1) {
        lines.push(`- ${concept.label}: ${concept.variants.join('; ')}`);
      } else {
        lines.push(`- ${concept.label}`);
      }
    }
    lines.push('');
  }
  lines.push('## Active workstreams');
  lines.push('');
  for (const item of payload.active_workstreams) {
    lines.push(`- **${item.name}** — ${item.unresolved_question}`);
  }
  lines.push('');
  lines.push('## Repeated research threads');
  lines.push('');
  for (const thread of payload.repeated_research_threads) {
    lines.push(`- **${thread.name}** — seen in ${thread.weeks_seen_count} weekly updates`);
  }
  lines.push('');
  lines.push('## Comparison work in flight');
  lines.push('');
  for (const comp of payload.comparison_work_in_flight) {
    lines.push(`- **${comp.name}** — weeks: ${comp.weeks_seen.join(', ')}`);
  }
  lines.push('');
  lines.push('## How to use this log');
  lines.push('');
  for (const tip of payload.how_to_use_this_log) {
    lines.push(`- ${tip}`);
  }
  lines.push('');
  return lines.join('\n');
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtml(payload) {
  const weekSections = payload.weekly_activity_log.map((week) => {
    const concepts = week.concepts.map((concept) => {
      const body = concept.variants.length > 1
        ? `<div class="variant-note">Variants / related labels: ${escapeHtml(concept.variants.join(' · '))}</div>`
        : '';
      return `<li><strong>${escapeHtml(concept.label)}</strong>${body}</li>`;
    }).join('');
    return `
      <section class="card">
        <h3>${escapeHtml(week.week_label)}</h3>
        <p class="meta">Concepts touched: ${week.concept_count}</p>
        <ul>${concepts}</ul>
      </section>`;
  }).join('');

  const workstreams = payload.active_workstreams.map((item) => `
    <li>
      <strong>${escapeHtml(item.name)}</strong>
      <div>${escapeHtml(item.unresolved_question)}</div>
      ${item.recent_examples && item.recent_examples.length ? `<div class="variant-note">Examples: ${escapeHtml(item.recent_examples.join(' · '))}</div>` : ''}
    </li>`).join('');

  const threads = payload.repeated_research_threads.map((item) => `
    <li><strong>${escapeHtml(item.name)}</strong> — seen in ${item.weeks_seen_count} weekly updates</li>`).join('');

  const comparisons = payload.comparison_work_in_flight.map((item) => `
    <li><strong>${escapeHtml(item.name)}</strong> — weeks: ${escapeHtml(item.weeks_seen.join(', '))}</li>`).join('');

  const tips = payload.how_to_use_this_log.map((tip) => `<li>${escapeHtml(tip)}</li>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(payload.title)}</title>
  <style>
    body { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 0; background: #fafafa; color: #1f2937; }
    main { max-width: 980px; margin: 0 auto; padding: 40px 20px 60px; }
    h1 { font-size: 2rem; margin: 0 0 8px; }
    h2 { font-size: 1.3rem; margin-top: 0; }
    h3 { font-size: 1.05rem; margin: 0 0 8px; }
    p { line-height: 1.6; }
    .lede { color: #4b5563; margin-bottom: 28px; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin: 24px 0 32px; }
    .stat { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 16px; }
    .stat .label { font-size: 0.85rem; color: #6b7280; margin-bottom: 6px; }
    .stat .value { font-size: 1.4rem; font-weight: 700; }
    .section { margin-top: 36px; }
    .cards { display: grid; gap: 14px; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 16px; }
    ul { margin: 10px 0 0 18px; padding: 0; }
    li { margin: 6px 0; line-height: 1.5; }
    .meta { color: #6b7280; font-size: 0.9rem; }
    .variant-note { color: #6b7280; font-size: 0.9rem; margin-top: 4px; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(payload.title)}</h1>
    <p class="lede">${escapeHtml(payload.summary)}</p>

    <section class="grid" aria-label="snapshot">
      <div class="stat"><div class="label">Weekly updates</div><div class="value">${payload.snapshot.weekly_updates}</div></div>
      <div class="stat"><div class="label">Tracked items</div><div class="value">${payload.snapshot.tracked_items}</div></div>
      <div class="stat"><div class="label">Linked decks in 30d window</div><div class="value">${payload.snapshot.linked_decks_in_window}</div></div>
      <div class="stat"><div class="label">Decks with ingested text available</div><div class="value">${payload.snapshot.decks_with_ingested_text_available}</div></div>
    </section>

    <section class="section">
      <h2>Weekly activity log</h2>
      <div class="cards">${weekSections}</div>
    </section>

    <section class="section card">
      <h2>Active workstreams</h2>
      <ul>${workstreams}</ul>
    </section>

    <section class="section card">
      <h2>Repeated research threads</h2>
      <ul>${threads}</ul>
    </section>

    <section class="section card">
      <h2>Comparison work in flight</h2>
      <ul>${comparisons}</ul>
    </section>

    <section class="section card">
      <h2>How to use this log</h2>
      <ul>${tips}</ul>
    </section>
  </main>
</body>
</html>`;
}

function main() {
  const publishRoot = process.argv[2];
  if (!publishRoot) {
    console.error('Usage: render_stage2_marketing_current.js <publish-root>');
    process.exit(1);
  }

  const root = path.resolve(publishRoot);
  const newsletterDir = path.join(root, 'newsletter');
  const apiDir = path.join(root, 'api');
  const dataDir = path.join(root, 'data');

  const sourceJsonPath = loadFirstExisting([
    path.join(newsletterDir, 'marketing-activity-30d.json'),
    path.join(apiDir, 'newsletter-marketing-activity-30d.json'),
  ]);
  if (!sourceJsonPath) {
    console.error('Could not find existing marketing activity JSON output.');
    process.exit(1);
  }

  const payload = stripEditorialRecommendations(normalizeDefaults(readJson(sourceJsonPath)));
  const weeksPath = loadFirstExisting([
    path.join(dataDir, 'weeks.json'),
  ]);
  const summaryPath = loadFirstExisting([
    path.join(dataDir, 'summary.json'),
  ]);
  const deckSummaryPath = loadFirstExisting([
    path.join(dataDir, 'deck_summary.json'),
    path.join(dataDir, 'deck-summary.json'),
  ]);

  const weeks = weeksPath ? readJson(weeksPath) : [];
  const summaryData = summaryPath ? readJson(summaryPath) : {};
  const deckSummary = deckSummaryPath ? readJson(deckSummaryPath) : {};

  const defaultWindowWeeks = Array.isArray(weeks)
    ? weeks.filter((w) => String(w.week_date || '') >= '2026-03-11').slice(0, 5)
    : [];

  const weeklyActivityLog = defaultWindowWeeks.map(summarizeWeek);
  const repeatedResearchThreads = buildRepeatedThreads(defaultWindowWeeks);
  const comparisonWorkInFlight = pickComparisonWork(defaultWindowWeeks);
  const activeWorkstreams = pickActiveWorkstreams(repeatedResearchThreads);
  const snapshot = deriveSnapshot(summaryData, defaultWindowWeeks, deckSummary);

  const cleaned = {
    title: 'Everpure research activity log (30d)',
    summary: 'A 30-day operations view of research cadence, volume, and active workstreams. Use this log to show what moved this month, where research effort is concentrating, and which comparisons are still in flight.',
    window: '30d',
    audience: 'marketing',
    tone: 'detailed',
    preset: 'marketing_activity_30d',
    defaults: {
      window: '30d',
      audience: 'marketing',
      tone: 'detailed',
      preset: 'marketing_activity_30d',
    },
    generated_at: new Date().toISOString(),
    snapshot,
    weekly_activity_log: weeklyActivityLog,
    active_workstreams: activeWorkstreams,
    repeated_research_threads: repeatedResearchThreads,
    comparison_work_in_flight: comparisonWorkInFlight,
    how_to_use_this_log: buildHowToUseThisLog(),
  };

  const md = buildMarkdown(cleaned);
  const html = buildHtml(cleaned);

  writeJson(path.join(newsletterDir, 'marketing-activity-30d.json'), cleaned);
  writeText(path.join(newsletterDir, 'marketing-activity-30d.md'), md + '\n');
  writeText(path.join(newsletterDir, 'marketing-activity-30d.html'), html + '\n');

  writeJson(path.join(apiDir, 'newsletter-marketing-activity-30d.json'), cleaned);
  writeText(path.join(apiDir, 'newsletter-marketing-activity-30d.md'), md + '\n');

  console.log(JSON.stringify({
    written: [
      path.join(newsletterDir, 'marketing-activity-30d.json'),
      path.join(newsletterDir, 'marketing-activity-30d.md'),
      path.join(newsletterDir, 'marketing-activity-30d.html'),
      path.join(apiDir, 'newsletter-marketing-activity-30d.json'),
      path.join(apiDir, 'newsletter-marketing-activity-30d.md'),
    ],
    weekly_updates: cleaned.snapshot.weekly_updates,
    tracked_items: cleaned.snapshot.tracked_items,
  }, null, 2));
}

main();
