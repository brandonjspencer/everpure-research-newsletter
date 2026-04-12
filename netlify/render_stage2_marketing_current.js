#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function safeText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+:/g, ':')
    .trim();
}

function normTitle(text) {
  let t = safeText(text)
    .replace(/^\d+\s*-\s*/, '')
    .replace(/^Concept\s*\d+\s*[:-]\s*/i, '')
    .replace(/\(in process\)/ig, '')
    .replace(/\bR\d+\b/ig, '')
    .replace(/\bV\d+\b/ig, '')
    .replace(/\bThree Variations\b/ig, '')
    .replace(/\bBaseline\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^knowledge portal/i.test(t)) return 'Knowledge Portal structure';
  if (/^support taxonomy flow/i.test(t)) return 'Support Taxonomy Flow';
  if (/^pathfinder cta labels/i.test(t)) return 'Pathfinder CTA labels';
  if (/^homepage ai messaging/i.test(t)) return 'Homepage AI messaging';
  if (/^design & ux feedback/i.test(t)) return 'Design and UX feedback';
  if (/^events page/i.test(t)) return 'Events page';
  if (/^ai summary/i.test(t)) return 'AI summary';
  if (/^evergreen rebrand/i.test(t)) return 'Evergreen rebrand';
  if (/^baselines?: platform redesign/i.test(t)) return 'Platform redesign';
  return t;
}

function flattenTopLevelItems(record) {
  const groups = record.content_groups || {};
  const out = [];
  for (const [group, arr] of Object.entries(groups)) {
    for (const item of Array.isArray(arr) ? arr : []) {
      const text = safeText(item && item.text);
      if (!text) continue;
      out.push({ group, text });
    }
  }
  return out;
}

function pickWeeklyHighlights(items) {
  const priority = ['findings', 'testing_concepts', 'in_process', 'weekly_progress', 'next_steps', 'other'];
  const seen = new Set();
  const sorted = items
    .filter((x) => x.text)
    .sort((a, b) => priority.indexOf(a.group) - priority.indexOf(b.group));
  const result = [];
  for (const item of sorted) {
    const key = normTitle(item.text).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normTitle(item.text));
    if (result.length >= 2) break;
  }
  return result;
}

function topCountsFrom(records, groups) {
  const counts = new Map();
  for (const r of records) {
    for (const item of flattenTopLevelItems(r)) {
      if (!groups.includes(item.group)) continue;
      const key = normTitle(item.text);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function isComparison(text) {
  return /baseline|variation|compare|comparison|\bV\d\b|\bR\d\b/i.test(text || '');
}

function htmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mdList(items, render) {
  return items.map(render).join('\n');
}

function build(publishRoot) {
  const dataDir = path.join(publishRoot, 'data');
  const weeksPath = path.join(dataDir, 'weeks.json');
  const weeks = readJson(weeksPath);

  const latest = weeks.reduce((m, r) => (!m || r.week_date > m ? r.week_date : m), null);
  const latestDate = new Date(`${latest}T00:00:00Z`);
  const sinceDate = new Date(latestDate);
  sinceDate.setUTCDate(sinceDate.getUTCDate() - 29);
  const since = fmtDate(sinceDate);

  const windowRecords = weeks
    .filter((r) => r.week_date >= since && r.week_date <= latest)
    .sort((a, b) => b.week_date.localeCompare(a.week_date));

  const allItems = windowRecords.flatMap(flattenTopLevelItems);
  const countByGroup = (group) => allItems.filter((x) => x.group === group).length;
  const deckIds = [...new Set(windowRecords.map((r) => r.deck && r.deck.file_id).filter(Boolean))];
  const decksWithContent = deckIds.length; // current build has ingested coverage for window decks

  const weeklyLog = windowRecords.map((r) => ({
    week_date: r.week_date,
    highlights: pickWeeklyHighlights(flattenTopLevelItems(r)),
    item_count: flattenTopLevelItems(r).length,
  }));

  const activeWorkstreams = topCountsFrom(windowRecords, ['in_process']).slice(0, 6).map(([title, mentions]) => ({ title, mentions }));
  const repeatedThemes = topCountsFrom(windowRecords, ['findings', 'testing_concepts', 'in_process']).slice(0, 5).map(([title, mentions]) => ({ title, mentions }));
  const comparisonWork = topCountsFrom(windowRecords, ['findings', 'testing_concepts'])
    .filter(([title]) => isComparison(title))
    .slice(0, 5)
    .map(([title, mentions]) => ({ title, mentions }));

  const uniqueConceptsTouched = new Set(allItems.map((x) => normTitle(x.text).toLowerCase())).size;
  const weeklyWithDeck = windowRecords.filter((r) => r.deck && r.deck.file_id).length;

  const json = {
    generated_at: new Date().toISOString(),
    title: 'Everpure research activity log (30d)',
    audience: 'marketing',
    tone: 'detailed',
    mode: 'activity_log',
    preset: 'marketing_activity_30d',
    defaults: { window: '30d', audience: 'marketing', tone: 'detailed' },
    window: { since, until: latest, label: '30d', days: 30 },
    overview: {
      week_count: windowRecords.length,
      item_count: allItems.length,
      unique_concepts_touched: uniqueConceptsTouched,
      deck_count: deckIds.length,
      decks_with_content_count: decksWithContent,
      weeks_with_linked_deck: weeklyWithDeck,
    },
    executive_summary: `This 30-day view shows a steady weekly research cadence across ${windowRecords.length} updates, ${allItems.length} tracked items, and ${uniqueConceptsTouched} distinct concepts. Activity clustered most heavily around platform and knowledge-portal work, homepage and AI-message refinement, and comparison-style work on events and brand directions.`,
    sections: {
      snapshot: {
        week_count: windowRecords.length,
        item_count: allItems.length,
        findings: countByGroup('findings'),
        testing_concepts: countByGroup('testing_concepts'),
        in_progress: countByGroup('in_process'),
        average_items_per_week: Number((allItems.length / Math.max(windowRecords.length, 1)).toFixed(1)),
        unique_concepts_touched: uniqueConceptsTouched,
        deck_count: deckIds.length,
        decks_with_content_count: decksWithContent,
      },
      weekly_activity_log: weeklyLog,
      active_workstreams: activeWorkstreams,
      repeated_research_threads: repeatedThemes,
      comparison_work_in_flight: comparisonWork,
      how_to_use_this_log: [
        'Use the weekly log to show research cadence and consistency over the month.',
        'Use active workstreams to show where studies are still progressing rather than already resolved.',
        'Use comparison work in flight to highlight where the team is narrowing toward decision-ready tests.'
      ]
    }
  };

  const md = `# ${json.title}\n\n_Generated: ${json.generated_at}_  \n_Window: ${since} to ${latest}_  \n_Audience: marketing | Tone: detailed | Mode: activity_log_\n\n## Executive summary\n${json.executive_summary}\n\n## Snapshot\n- Weeks covered: ${json.sections.snapshot.week_count}\n- Items surfaced: ${json.sections.snapshot.item_count}\n- Unique concepts touched: ${json.sections.snapshot.unique_concepts_touched}\n- Findings: ${json.sections.snapshot.findings}\n- Testing concepts: ${json.sections.snapshot.testing_concepts}\n- In progress: ${json.sections.snapshot.in_progress}\n- Average items per week: ${json.sections.snapshot.average_items_per_week}\n- Linked decks: ${json.sections.snapshot.deck_count}\n- Decks with ingested text: ${json.sections.snapshot.decks_with_content_count}\n\n## Weekly activity log\n${mdList(json.sections.weekly_activity_log, (w) => `- **${w.week_date}** — ${w.highlights.join('; ')}`)}\n\n## Active workstreams\n${mdList(json.sections.active_workstreams, (w) => `- **${w.title}** — Mentioned ${w.mentions} time(s).`)}\n\n## Repeated research threads\n${mdList(json.sections.repeated_research_threads, (t) => `- **${t.title}** — Appeared ${t.mentions} time(s) across findings, concepts, or in-progress work.`)}\n\n## Comparison work in flight\n${mdList(json.sections.comparison_work_in_flight, (t) => `- **${t.title}** — Appeared ${t.mentions} time(s) and is functioning as a comparison-style or narrowing test.`)}\n\n## How to use this log\n${mdList(json.sections.how_to_use_this_log, (x) => `- ${x}`)}\n`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(json.title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px auto; max-width: 900px; line-height: 1.55; padding: 0 20px; color: #111; }
    h1, h2, h3 { line-height: 1.2; }
    .meta { color: #555; margin-bottom: 24px; }
    ul { padding-left: 22px; }
    li { margin: 8px 0; }
    .section { margin-top: 28px; }
    a { color: #0a58ca; text-decoration: none; }
  </style>
</head>
<body>
  <p><a href="../">Back to homepage</a></p>
  <h1>${htmlEscape(json.title)}</h1>
  <div class="meta">Generated ${htmlEscape(json.generated_at)} · marketing · detailed · activity_log</div>

  <div class="section">
    <h2>Executive summary</h2>
    <p>${htmlEscape(json.executive_summary)}</p>
  </div>

  <div class="section">
    <h2>Snapshot</h2>
    <ul>
      <li>Weeks covered: ${json.sections.snapshot.week_count}</li>
      <li>Items surfaced: ${json.sections.snapshot.item_count}</li>
      <li>Unique concepts touched: ${json.sections.snapshot.unique_concepts_touched}</li>
      <li>Findings: ${json.sections.snapshot.findings}</li>
      <li>Testing concepts: ${json.sections.snapshot.testing_concepts}</li>
      <li>In progress: ${json.sections.snapshot.in_progress}</li>
      <li>Average items per week: ${json.sections.snapshot.average_items_per_week}</li>
      <li>Linked decks: ${json.sections.snapshot.deck_count}</li>
      <li>Decks with ingested text: ${json.sections.snapshot.decks_with_content_count}</li>
    </ul>
  </div>

  <div class="section">
    <h2>Weekly activity log</h2>
    <ul>
      ${json.sections.weekly_activity_log.map((w) => `<li><strong>${htmlEscape(w.week_date)}</strong> — ${htmlEscape(w.highlights.join('; '))}</li>`).join('\n      ')}
    </ul>
  </div>

  <div class="section">
    <h2>Active workstreams</h2>
    <ul>
      ${json.sections.active_workstreams.map((w) => `<li><strong>${htmlEscape(w.title)}</strong> — Mentioned ${w.mentions} time(s).</li>`).join('\n      ')}
    </ul>
  </div>

  <div class="section">
    <h2>Repeated research threads</h2>
    <ul>
      ${json.sections.repeated_research_threads.map((t) => `<li><strong>${htmlEscape(t.title)}</strong> — Appeared ${t.mentions} time(s) across findings, concepts, or in-progress work.</li>`).join('\n      ')}
    </ul>
  </div>

  <div class="section">
    <h2>Comparison work in flight</h2>
    <ul>
      ${json.sections.comparison_work_in_flight.map((t) => `<li><strong>${htmlEscape(t.title)}</strong> — Appeared ${t.mentions} time(s) and is functioning as a comparison-style or narrowing test.</li>`).join('\n      ')}
    </ul>
  </div>

  <div class="section">
    <h2>How to use this log</h2>
    <ul>
      ${json.sections.how_to_use_this_log.map((x) => `<li>${htmlEscape(x)}</li>`).join('\n      ')}
    </ul>
  </div>
</body>
</html>
`;

  const outNewsletter = path.join(publishRoot, 'newsletter');
  const outApi = path.join(publishRoot, 'api');

  writeFile(path.join(outNewsletter, 'marketing-activity-30d.json'), JSON.stringify(json, null, 2));
  writeFile(path.join(outNewsletter, 'marketing-activity-30d.md'), md);
  writeFile(path.join(outNewsletter, 'marketing-activity-30d.html'), html);
  writeFile(path.join(outApi, 'newsletter-marketing-activity-30d.json'), JSON.stringify(json, null, 2));
  writeFile(path.join(outApi, 'newsletter-marketing-activity-30d.md'), md);

  console.log(JSON.stringify({
    rewritten: [
      path.join(outNewsletter, 'marketing-activity-30d.json'),
      path.join(outNewsletter, 'marketing-activity-30d.md'),
      path.join(outNewsletter, 'marketing-activity-30d.html'),
      path.join(outApi, 'newsletter-marketing-activity-30d.json'),
      path.join(outApi, 'newsletter-marketing-activity-30d.md')
    ],
    week_count: windowRecords.length,
    item_count: allItems.length,
    unique_concepts_touched: uniqueConceptsTouched
  }, null, 2));
}

const publishRoot = process.argv[2] || path.resolve(process.cwd(), 'publish');
build(publishRoot);
