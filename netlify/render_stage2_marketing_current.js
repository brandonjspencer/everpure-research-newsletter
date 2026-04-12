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

function loadFirstExisting(paths) {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function stripConceptId(text) {
  return String(text || '')
    .replace(/^\s*\d+\s*[-–:]\s*/, '')
    .replace(/^\s*Concept\s*\d+\s*[-–:]\s*/i, '')
    .replace(/\(in process\)/ig, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:\-–]+$/, '')
    .trim();
}

function titleCase(text) {
  return String(text || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function pickWorkstream(label, parentLabel) {
  const raw = stripConceptId(label).toLowerCase();
  const parent = stripConceptId(parentLabel || '').toLowerCase();

  if (/event/.test(raw) || /event/.test(parent)) {
    return {
      key: 'events',
      name: 'Events',
      unresolved_question: 'Which event-page structure and content framing should move forward after the baseline / V1 / V2 comparison?',
    };
  }
  if (/ai summary/.test(raw) || /homepage ai messaging/.test(raw)) {
    return {
      key: 'ai-summary',
      name: 'AI Summary & Messaging',
      unresolved_question: 'Which one or two AI framings are strongest enough to take into the next comparison round?',
    };
  }
  if (/evergreen rebrand/.test(raw)) {
    return {
      key: 'evergreen-rebrand',
      name: 'Evergreen Rebrand',
      unresolved_question: 'Which visual pacing choices improve appeal without hurting comprehension?',
    };
  }
  if (/knowledge portal/.test(raw) || /knowledge portal/.test(parent)) {
    return {
      key: 'knowledge-portal',
      name: 'Knowledge Portal',
      unresolved_question: 'Which naming and domain framing makes the portal feel most intuitive and support-led?',
    };
  }
  if (/support taxonomy/.test(raw)) {
    return {
      key: 'support-taxonomy',
      name: 'Support Taxonomy',
      unresolved_question: 'Which labels and navigation paths still break support expectations and need refinement?',
    };
  }
  if (/design\s*&\s*ux feedback/.test(raw)) {
    return {
      key: 'design-ux-feedback',
      name: 'Design & UX Feedback',
      unresolved_question: 'Which page-level fixes should be prioritized across the reviewed surfaces?',
    };
  }
  if (/pathfinder/.test(raw)) {
    return {
      key: 'pathfinder',
      name: 'Pathfinder',
      unresolved_question: 'Which labels or journey cues need to become clearer before the next validation round?',
    };
  }
  if (/platform redesign/.test(raw) || /baselines?/.test(raw)) {
    return {
      key: 'platform-redesign',
      name: 'Platform Redesign',
      unresolved_question: 'Which simplified structure improves comprehension and sentiment enough to justify the next design move?',
    };
  }
  if (/infinite scroll/.test(raw)) {
    return {
      key: 'infinite-scroll',
      name: 'Infinite Scroll',
      unresolved_question: 'Does infinite scroll improve content discovery enough to warrant more testing?',
    };
  }
  return {
    key: raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'misc',
    name: titleCase(raw),
    unresolved_question: 'What does this line of work need to prove in the next round of research?',
  };
}

function parseWeeklyRecords(weeks) {
  const records = [];
  const groupKeys = [
    'findings',
    'testing_concepts',
    'in_process',
    'weekly_progress',
    'next_steps',
  ];

  for (const week of weeks) {
    const weekLabel = week.week_label_raw || week.weekLabelRaw || week.week_date || week.weekDate || '';
    const groups = week.content_groups || week.contentGroups || {};

    for (const key of groupKeys) {
      const items = groups[key];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (!item) continue;
        const text = typeof item === 'string' ? item : (item.text || item.title || '');
        const cleanText = stripConceptId(text);
        if (!cleanText) continue;
        if (/^view\b/i.test(cleanText)) continue;
        const parentWs = pickWorkstream(cleanText);
        const children = Array.isArray(item.children)
          ? item.children
              .map((child) => stripConceptId(child && child.text))
              .filter(Boolean)
              .filter((name) => !/^view\b/i.test(name))
          : [];

        if (children.length && parentWs.key === 'design-ux-feedback') {
          records.push({
            week_label: weekLabel,
            week_date: week.week_date || week.weekDate || '',
            key: parentWs.key,
            name: parentWs.name,
            examples: children,
            source_label: cleanText,
            group_key: key,
          });
          continue;
        }

        const ws = pickWorkstream(cleanText, cleanText);
        records.push({
          week_label: weekLabel,
          week_date: week.week_date || week.weekDate || '',
          key: ws.key,
          name: ws.name,
          examples: children.length ? children : [cleanText],
          source_label: cleanText,
          group_key: key,
        });
      }
    }
  }

  return records;
}

function unique(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function groupByWeek(records) {
  const weekMap = new Map();
  for (const record of records) {
    if (!weekMap.has(record.week_label)) {
      weekMap.set(record.week_label, {
        week_label: record.week_label,
        week_date: record.week_date,
        workstreams: new Map(),
      });
    }
    const week = weekMap.get(record.week_label);
    if (!week.workstreams.has(record.key)) {
      week.workstreams.set(record.key, {
        key: record.key,
        name: record.name,
        examples: new Set(),
        labels: new Set(),
      });
    }
    const ws = week.workstreams.get(record.key);
    record.examples.forEach((ex) => ws.examples.add(ex));
    ws.labels.add(record.source_label);
  }

  return Array.from(weekMap.values())
    .sort((a, b) => String(b.week_date).localeCompare(String(a.week_date)))
    .map((week) => ({
      week_label: week.week_label,
      week_date: week.week_date,
      workstreams: Array.from(week.workstreams.values())
        .map((ws) => ({
          key: ws.key,
          name: ws.name,
          examples: Array.from(ws.examples),
          labels: Array.from(ws.labels),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

function buildThreadSummary(records) {
  const map = new Map();
  for (const record of records) {
    if (!map.has(record.key)) {
      map.set(record.key, {
        key: record.key,
        name: record.name,
        unresolved_question: pickWorkstream(record.name).unresolved_question,
        weeks: new Set(),
        examples: new Set(),
        labels: new Set(),
      });
    }
    const entry = map.get(record.key);
    entry.weeks.add(record.week_label);
    record.examples.forEach((ex) => entry.examples.add(ex));
    entry.labels.add(record.source_label);
  }

  return Array.from(map.values())
    .map((entry) => ({
      key: entry.key,
      name: entry.name,
      unresolved_question: entry.unresolved_question,
      weeks_seen_count: entry.weeks.size,
      examples: Array.from(entry.examples),
      labels: Array.from(entry.labels),
      weeks_seen: Array.from(entry.weeks),
    }))
    .sort((a, b) => b.weeks_seen_count - a.weeks_seen_count || a.name.localeCompare(b.name));
}

function deriveSnapshot(summaryData, weeklyLog, deckSummary) {
  return {
    window: '30d',
    weekly_updates: weeklyLog.length,
    tracked_items: summaryData.record_count || summaryData.item_count || summaryData.tracked_item_count || 0,
    linked_decks_in_window: summaryData.deck_count || summaryData.linked_deck_count || 0,
    decks_with_ingested_text_available:
      deckSummary.ingested_pdf_count || deckSummary.deck_content_count || summaryData.deck_content_count || 0,
  };
}

function buildActiveWorkstreams(threads) {
  const priority = [
    'events',
    'evergreen-rebrand',
    'knowledge-portal',
    'support-taxonomy',
    'design-ux-feedback',
    'ai-summary',
    'platform-redesign',
    'pathfinder',
  ];
  const priorityMap = new Map(priority.map((k, i) => [k, i]));
  return threads
    .slice()
    .sort((a, b) => {
      const pa = priorityMap.has(a.key) ? priorityMap.get(a.key) : 99;
      const pb = priorityMap.has(b.key) ? priorityMap.get(b.key) : 99;
      return pa - pb || b.weeks_seen_count - a.weeks_seen_count || a.name.localeCompare(b.name);
    })
    .slice(0, 5)
    .map((thread) => ({
      name: thread.name,
      unresolved_question: thread.unresolved_question,
      recent_examples: thread.examples.slice(0, 5),
    }));
}

function buildRepeatedThreads(threads) {
  return threads
    .filter((thread) => thread.weeks_seen_count >= 2)
    .map((thread) => ({
      name: thread.name,
      weeks_seen_count: thread.weeks_seen_count,
      examples: thread.examples.slice(0, 4),
    }));
}

function buildComparisonWork(threads) {
  const items = [];
  const add = (key, name, criteria, examples, weeks) => {
    if (!examples || !examples.length) return;
    items.push({ name, decision_criteria: criteria, examples, weeks_seen: weeks.slice(0, 4) });
  };

  const byKey = new Map(threads.map((t) => [t.key, t]));

  const events = byKey.get('events');
  if (events) {
    const ex = unique(events.labels.concat(events.examples)).filter((x) => /baseline|v\d+/i.test(x) || /event/i.test(x));
    add('events', 'Events', 'Pick the version that gives the clearest event-page direction with the fewest comprehension tradeoffs.', ex, events.weeks_seen);
  }

  const ai = byKey.get('ai-summary');
  if (ai) {
    const ex = unique(ai.labels.concat(ai.examples));
    add('ai-summary', 'AI Summary & Messaging', 'Reduce to the strongest one or two framings, then choose the version that is clearest and easiest to act on.', ex, ai.weeks_seen);
  }

  const evergreen = byKey.get('evergreen-rebrand');
  if (evergreen && evergreen.labels.some((x) => /r\d+/i.test(x))) {
    add('evergreen-rebrand', 'Evergreen Rebrand', 'Keep the pacing and layout moves that improve appeal without making the page feel too technical too early.', unique(evergreen.labels), evergreen.weeks_seen);
  }

  return items;
}

function buildHowToUseThisLog() {
  return [
    'Use this page to show research cadence and volume across the last 30 days, not to make final ship / hold calls.',
    'Treat repeated threads as signs of where research capacity is concentrating over multiple weekly updates.',
    'Use comparison work in flight to understand which decisions are narrowing, even when a final winner is not chosen yet.',
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
  lines.push(`- Decks with ingested text in site corpus: ${payload.snapshot.decks_with_ingested_text_available}`);
  lines.push('');
  lines.push('## Weekly activity log');
  lines.push('');
  for (const week of payload.weekly_activity_log) {
    lines.push(`### ${week.week_label}`);
    for (const ws of week.workstreams) {
      if (ws.examples.length) {
        lines.push(`- **${ws.name}** — ${ws.examples.join('; ')}`);
      } else {
        lines.push(`- **${ws.name}**`);
      }
    }
    lines.push('');
  }
  lines.push('## Active workstreams');
  lines.push('');
  for (const item of payload.active_workstreams) {
    lines.push(`- **${item.name}** — ${item.unresolved_question}`);
    if (item.recent_examples.length) {
      lines.push(`  - Recent examples: ${item.recent_examples.join('; ')}`);
    }
  }
  lines.push('');
  lines.push('## Repeated research threads');
  lines.push('');
  for (const item of payload.repeated_research_threads) {
    lines.push(`- **${item.name}** — seen in ${item.weeks_seen_count} weekly updates`);
  }
  lines.push('');
  lines.push('## Comparison work in flight');
  lines.push('');
  for (const item of payload.comparison_work_in_flight) {
    lines.push(`- **${item.name}** — ${item.decision_criteria}`);
    if (item.examples.length) {
      lines.push(`  - Variants / examples: ${item.examples.join('; ')}`);
    }
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
    const items = week.workstreams.map((ws) => {
      const examples = ws.examples.length ? `<div class="subtle">Examples: ${escapeHtml(ws.examples.join(' · '))}</div>` : '';
      return `<li><strong>${escapeHtml(ws.name)}</strong>${examples}</li>`;
    }).join('');
    return `
      <section class="card">
        <h3>${escapeHtml(week.week_label)}</h3>
        <ul>${items}</ul>
      </section>`;
  }).join('');

  const workstreams = payload.active_workstreams.map((item) => {
    const examples = item.recent_examples.length ? `<div class="subtle">Recent examples: ${escapeHtml(item.recent_examples.join(' · '))}</div>` : '';
    return `<li><strong>${escapeHtml(item.name)}</strong><div>${escapeHtml(item.unresolved_question)}</div>${examples}</li>`;
  }).join('');

  const threads = payload.repeated_research_threads.map((item) =>
    `<li><strong>${escapeHtml(item.name)}</strong> — seen in ${item.weeks_seen_count} weekly updates</li>`
  ).join('');

  const comparisons = payload.comparison_work_in_flight.map((item) => {
    const examples = item.examples.length ? `<div class="subtle">Variants / examples: ${escapeHtml(item.examples.join(' · '))}</div>` : '';
    return `<li><strong>${escapeHtml(item.name)}</strong><div>${escapeHtml(item.decision_criteria)}</div>${examples}</li>`;
  }).join('');

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
    li { margin: 10px 0; line-height: 1.5; }
    .subtle { color: #6b7280; font-size: 0.95rem; margin-top: 4px; }
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
      <div class="stat"><div class="label">Decks with ingested text in site corpus</div><div class="value">${payload.snapshot.decks_with_ingested_text_available}</div></div>
    </section>

    <section class="section">
      <h2>Weekly activity log</h2>
      <div class="cards">${weekSections}</div>
    </section>

    <section class="section card">
      <h2>Active workstreams</h2>
      <ul>${workstreams}</ul>
    </section>

    ${payload.repeated_research_threads.length ? `
    <section class="section card">
      <h2>Repeated research threads</h2>
      <ul>${threads}</ul>
    </section>` : ''}

    ${payload.comparison_work_in_flight.length ? `
    <section class="section card">
      <h2>Comparison work in flight</h2>
      <ul>${comparisons}</ul>
    </section>` : ''}

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

  const weeksPath = loadFirstExisting([path.join(dataDir, 'weeks.json')]);
  const summaryPath = loadFirstExisting([path.join(dataDir, 'summary.json')]);
  const deckSummaryPath = loadFirstExisting([
    path.join(dataDir, 'deck_summary.json'),
    path.join(dataDir, 'deck-summary.json'),
  ]);

  if (!weeksPath || !summaryPath) {
    console.error('Could not find required source data for marketing stage-2 writer.');
    process.exit(1);
  }

  const weeks = readJson(weeksPath);
  const summaryData = readJson(summaryPath);
  const deckSummary = deckSummaryPath ? readJson(deckSummaryPath) : {};

  const latestWeekDate = Array.isArray(weeks) && weeks.length ? String(weeks[0].week_date || '') : '';
  const latest = latestWeekDate ? new Date(latestWeekDate + 'T00:00:00Z') : null;
  const cutoff = latest ? new Date(latest.getTime() - 29 * 24 * 60 * 60 * 1000) : null;
  const windowWeeks = Array.isArray(weeks)
    ? weeks.filter((week) => {
        if (!cutoff) return true;
        const d = new Date(String(week.week_date || '') + 'T00:00:00Z');
        return !Number.isNaN(d.getTime()) && d >= cutoff && d <= latest;
      })
    : [];

  const records = parseWeeklyRecords(windowWeeks);
  const weeklyActivityLog = groupByWeek(records);
  const threads = buildThreadSummary(records);
  const payload = {
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
    snapshot: deriveSnapshot(summaryData, weeklyActivityLog, deckSummary),
    weekly_activity_log: weeklyActivityLog,
    active_workstreams: buildActiveWorkstreams(threads),
    repeated_research_threads: buildRepeatedThreads(threads),
    comparison_work_in_flight: buildComparisonWork(threads),
    how_to_use_this_log: buildHowToUseThisLog(),
  };

  const md = buildMarkdown(payload);
  const html = buildHtml(payload);

  writeJson(path.join(newsletterDir, 'marketing-activity-30d.json'), payload);
  writeText(path.join(newsletterDir, 'marketing-activity-30d.md'), md + '\n');
  writeText(path.join(newsletterDir, 'marketing-activity-30d.html'), html + '\n');
  writeJson(path.join(apiDir, 'newsletter-marketing-activity-30d.json'), payload);
  writeText(path.join(apiDir, 'newsletter-marketing-activity-30d.md'), md + '\n');

  console.log(JSON.stringify({
    written: [
      path.join(newsletterDir, 'marketing-activity-30d.json'),
      path.join(newsletterDir, 'marketing-activity-30d.md'),
      path.join(newsletterDir, 'marketing-activity-30d.html'),
      path.join(apiDir, 'newsletter-marketing-activity-30d.json'),
      path.join(apiDir, 'newsletter-marketing-activity-30d.md'),
    ],
    weekly_updates: payload.snapshot.weekly_updates,
    repeated_threads: payload.repeated_research_threads.length,
    comparison_tracks: payload.comparison_work_in_flight.length,
  }, null, 2));
}

main();
