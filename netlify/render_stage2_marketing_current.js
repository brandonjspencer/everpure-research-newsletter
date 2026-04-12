#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text, 'utf8');
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function parseDate(s) {
  return new Date(`${s}T00:00:00Z`);
}

function htmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

function titleCase(s) {
  return String(s)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function flattenTexts(nodes, out = []) {
  if (!Array.isArray(nodes)) return out;
  for (const n of nodes) {
    const text = (n && typeof n.text === 'string') ? n.text.trim() : '';
    if (text) out.push(text);
    if (n && Array.isArray(n.children)) flattenTexts(n.children, out);
  }
  return out;
}

function cleanConceptLabel(text) {
  let t = String(text || '').trim();
  if (!t) return '';
  t = t.replace(/^\d+\s*[-–:]\s*/, '');
  t = t.replace(/^concept\s*\d+\s*[-–:]\s*/i, '');
  t = t.replace(/\s*\((?:in process|received|internal)\)\s*/ig, '');
  t = t.replace(/^👉\s*/,'').replace(/^🧠\s*/,'').replace(/^📈\s*/,'').replace(/^💜\s*/,'');
  t = t.replace(/^view\s+/i, '');
  return t.trim();
}

function isMeaningfulText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.length < 4) return false;
  if (/^view\b/i.test(t)) return false;
  if (/^we('?re| will| owe| outlined| excited| back)/i.test(t)) return false;
  if (/^ux metrics/i.test(t)) return false;
  if (/^success\b/i.test(t)) return false;
  if (/^frequency\b/i.test(t)) return false;
  if (/^editorial recommendations$/i.test(t)) return false;
  return true;
}

function collectWeeklyItems(week) {
  const groups = week.content_groups || {};
  const buckets = [
    ['findings', 'findings'],
    ['testing_concepts', 'testing concepts'],
    ['in_process', 'in process'],
    ['weekly_progress', 'weekly progress'],
    ['next_steps', 'next steps'],
    ['other', 'other']
  ];
  const items = [];
  for (const [key, label] of buckets) {
    const texts = flattenTexts(groups[key] || [])
      .map(cleanConceptLabel)
      .filter(isMeaningfulText);
    for (const text of texts) {
      items.push({ bucket: label, text });
    }
  }
  return items;
}

function aggregateThreads(weeks) {
  const map = new Map();
  const comparison = new Map();
  for (const week of weeks) {
    const items = collectWeeklyItems(week);
    for (const item of items) {
      const label = item.text;
      const key = slugify(label);
      if (!map.has(key)) {
        map.set(key, {
          label,
          weeks: new Set(),
          buckets: new Set(),
          count: 0,
          latest_week: week.week_date,
        });
      }
      const entry = map.get(key);
      entry.weeks.add(week.week_date);
      entry.buckets.add(item.bucket);
      entry.count += 1;
      if (week.week_date > entry.latest_week) entry.latest_week = week.week_date;

      if (/(\bv1\b|\bv2\b|\br2\b|\br3\b|variation|baseline|comparison|three variations)/i.test(label)) {
        if (!comparison.has(key)) comparison.set(key, { label, weeks: new Set(), latest_week: week.week_date });
        comparison.get(key).weeks.add(week.week_date);
        if (week.week_date > comparison.get(key).latest_week) comparison.get(key).latest_week = week.week_date;
      }
    }
  }
  const threads = [...map.values()]
    .map((v) => ({
      label: v.label,
      weeks_seen: [...v.weeks].sort(),
      bucket_types: [...v.buckets],
      mentions: v.count,
      latest_week: v.latest_week,
    }))
    .sort((a, b) => b.weeks_seen.length - a.weeks_seen.length || b.mentions - a.mentions || a.label.localeCompare(b.label));
  const comparisons = [...comparison.values()]
    .map((v) => ({ label: v.label, weeks_seen: [...v.weeks].sort(), latest_week: v.latest_week }))
    .sort((a, b) => b.weeks_seen.length - a.weeks_seen.length || a.label.localeCompare(b.label));
  return { threads, comparisons };
}

function formatDateHuman(s) {
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(parseDate(s));
  } catch {
    return s;
  }
}

function renderMarkdown(model) {
  const lines = [];
  lines.push(`# ${model.title}`);
  lines.push('');
  lines.push(model.summary);
  lines.push('');
  lines.push(`- Window: ${model.window_label}`);
  lines.push(`- Weekly updates: ${model.snapshot.weekly_updates}`);
  lines.push(`- Tracked items: ${model.snapshot.tracked_items}`);
  lines.push(`- Linked decks: ${model.snapshot.linked_decks}`);
  lines.push(`- Decks with ingested text: ${model.snapshot.ingested_decks}`);
  lines.push('');
  lines.push('## Weekly activity log');
  lines.push('');
  for (const w of model.weekly_log) {
    lines.push(`### ${w.week_label}`);
    lines.push('');
    if (w.highlights.length) {
      for (const h of w.highlights) lines.push(`- ${h}`);
    } else {
      lines.push('- No major highlights captured.');
    }
    lines.push('');
  }
  lines.push('## Active workstreams');
  lines.push('');
  for (const item of model.active_workstreams) {
    lines.push(`- **${item.label}** — seen in ${item.weeks_seen.length} week(s); latest ${formatDateHuman(item.latest_week)}.`);
  }
  lines.push('');
  lines.push('## Repeated research threads');
  lines.push('');
  for (const item of model.repeated_threads) {
    lines.push(`- **${item.label}** — ${item.mentions} mentions across ${item.weeks_seen.length} week(s).`);
  }
  lines.push('');
  lines.push('## Comparison work in flight');
  lines.push('');
  if (model.comparison_work.length) {
    for (const item of model.comparison_work) {
      lines.push(`- **${item.label}** — active across ${item.weeks_seen.length} week(s).`);
    }
  } else {
    lines.push('- No active comparison threads identified in the current 30-day window.');
  }
  lines.push('');
  lines.push('## How to use this log');
  lines.push('');
  for (const tip of model.how_to_use) lines.push(`- ${tip}`);
  lines.push('');
  return lines.join('\n');
}

function renderHtml(model) {
  const section = (title, body) => `\n<section><h2>${htmlEscape(title)}</h2>${body}</section>`;
  const list = (items, renderItem) => `<ul>${items.map((item) => `<li>${renderItem(item)}</li>`).join('')}</ul>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(model.title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; background: #f7f7f8; color: #111; }
    main { max-width: 960px; margin: 0 auto; padding: 40px 20px 60px; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    h2 { margin-top: 2rem; font-size: 1.25rem; }
    h3 { margin-bottom: 0.4rem; }
    .meta, .note { color: #555; }
    .card { background: white; border-radius: 12px; padding: 16px 18px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); margin: 12px 0; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 20px 0; }
    .stat { background: white; border-radius: 12px; padding: 14px 16px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
    .stat strong { display:block; font-size:1.4rem; }
    ul { padding-left: 1.2rem; }
    li { margin: 0.35rem 0; }
    .muted { color: #666; font-size: 0.95rem; }
    code { background:#f0f0f2; padding:0.1rem 0.35rem; border-radius:4px; }
  </style>
</head>
<body>
  <main>
    <h1>${htmlEscape(model.title)}</h1>
    <p class="meta">${htmlEscape(model.summary)}</p>
    <p class="note">Window: ${htmlEscape(model.window_label)}</p>

    <div class="stats">
      <div class="stat"><span class="muted">Weekly updates</span><strong>${model.snapshot.weekly_updates}</strong></div>
      <div class="stat"><span class="muted">Tracked items</span><strong>${model.snapshot.tracked_items}</strong></div>
      <div class="stat"><span class="muted">Linked decks</span><strong>${model.snapshot.linked_decks}</strong></div>
      <div class="stat"><span class="muted">Decks with ingested text</span><strong>${model.snapshot.ingested_decks}</strong></div>
    </div>

    ${section('Weekly activity log', model.weekly_log.map((w) => `<div class="card"><h3>${htmlEscape(w.week_label)}</h3>${list(w.highlights.length ? w.highlights : ['No major highlights captured.'], (h) => htmlEscape(h))}</div>`).join(''))}

    ${section('Active workstreams', list(model.active_workstreams, (item) => `<strong>${htmlEscape(item.label)}</strong> — seen in ${item.weeks_seen.length} week(s); latest ${htmlEscape(formatDateHuman(item.latest_week))}.`))}

    ${section('Repeated research threads', list(model.repeated_threads, (item) => `<strong>${htmlEscape(item.label)}</strong> — ${item.mentions} mentions across ${item.weeks_seen.length} week(s).`))}

    ${section('Comparison work in flight', model.comparison_work.length ? list(model.comparison_work, (item) => `<strong>${htmlEscape(item.label)}</strong> — active across ${item.weeks_seen.length} week(s).`) : '<p>No active comparison threads identified in the current 30-day window.</p>')}

    ${section('How to use this log', list(model.how_to_use, (tip) => htmlEscape(tip)))}
  </main>
</body>
</html>`;
}

function main() {
  const publishRoot = process.argv[2] || 'publish';
  const newsletterDir = path.join(publishRoot, 'newsletter');
  const apiDir = path.join(publishRoot, 'api');
  const dataDir = path.join(publishRoot, 'data');

  const weeks = readJson(path.join(dataDir, 'weeks.json'), []);
  const deckSummary = readJson(path.join(dataDir, 'deck_summary.json'), {});
  const deckContentSummary = readJson(path.join(dataDir, 'deck_content_summary.json'), {});

  const datedWeeks = weeks.filter((w) => w && w.week_date).sort((a, b) => a.week_date.localeCompare(b.week_date));
  const latestWeekDate = datedWeeks.length ? datedWeeks[datedWeeks.length - 1].week_date : isoDate(new Date());
  const cutoff = parseDate(latestWeekDate);
  cutoff.setUTCDate(cutoff.getUTCDate() - 29);

  const windowWeeks = datedWeeks.filter((w) => parseDate(w.week_date) >= cutoff);
  const windowLabel = `${formatDateHuman(isoDate(cutoff))} to ${formatDateHuman(latestWeekDate)}`;

  const trackedItems = windowWeeks.reduce((sum, week) => sum + collectWeeklyItems(week).length, 0);
  const linkedDeckIds = new Set(windowWeeks.map((w) => w.deck && w.deck.file_id).filter(Boolean));
  const ingestedDecks = (() => {
    if (typeof deckContentSummary.deck_count === 'number') return deckContentSummary.deck_count;
    if (typeof deckContentSummary.ingested_pdf_count === 'number') return deckContentSummary.ingested_pdf_count;
    return 0;
  })();

  const weeklyLog = windowWeeks
    .slice()
    .sort((a, b) => b.week_date.localeCompare(a.week_date))
    .map((week) => {
      const items = collectWeeklyItems(week)
        .map((i) => i.text)
        .filter(isMeaningfulText);
      const unique = [...new Set(items)].slice(0, 6);
      return {
        week_date: week.week_date,
        week_label: formatDateHuman(week.week_date),
        highlights: unique,
      };
    });

  const { threads, comparisons } = aggregateThreads(windowWeeks);
  const activeWorkstreams = threads.filter((t) => t.weeks_seen.length >= 2).slice(0, 8);
  const repeatedThreads = threads.slice(0, 8);
  const comparisonWork = comparisons.slice(0, 6);

  const model = {
    kind: 'marketing_activity_log',
    preset: 'marketing_activity_30d',
    audience: 'marketing',
    tone: 'detailed',
    defaults: {
      window: '30d',
      audience: 'marketing',
      tone: 'detailed',
      preset: 'marketing_activity_30d'
    },
    title: 'Everpure Research Activity Log (30d)',
    summary: 'A 30-day view of research cadence, active testing volume, and the workstreams currently moving through the Everpure pipeline.',
    generated_at: new Date().toISOString(),
    window_label: windowLabel,
    latest_week_date: latestWeekDate,
    snapshot: {
      weekly_updates: windowWeeks.length,
      tracked_items: trackedItems,
      linked_decks: linkedDeckIds.size,
      ingested_decks: ingestedDecks,
    },
    weekly_log: weeklyLog,
    active_workstreams: activeWorkstreams,
    repeated_threads: repeatedThreads,
    comparison_work: comparisonWork,
    how_to_use: [
      'Use this log to show research cadence and throughput, not to make shipping decisions.',
      'Start with the weekly activity log to understand what moved each week, then scan repeated research threads to see where effort is clustering.',
      'Use the comparison section to identify tests that are still narrowing options and may need one more round before becoming decision-ready.'
    ]
  };

  const markdown = renderMarkdown(model);
  const html = renderHtml(model);
  const json = JSON.stringify(model, null, 2) + '\n';

  writeText(path.join(newsletterDir, 'marketing-activity-30d.json'), json);
  writeText(path.join(newsletterDir, 'marketing-activity-30d.md'), markdown);
  writeText(path.join(newsletterDir, 'marketing-activity-30d.html'), html);

  writeText(path.join(apiDir, 'newsletter-marketing-activity-30d.json'), json);
  writeText(path.join(apiDir, 'newsletter-marketing-activity-30d.md'), markdown);

  console.log(JSON.stringify({
    written: [
      path.join(newsletterDir, 'marketing-activity-30d.json'),
      path.join(newsletterDir, 'marketing-activity-30d.md'),
      path.join(newsletterDir, 'marketing-activity-30d.html'),
      path.join(apiDir, 'newsletter-marketing-activity-30d.json'),
      path.join(apiDir, 'newsletter-marketing-activity-30d.md')
    ],
    latest_week_date: latestWeekDate,
    weekly_updates: windowWeeks.length,
    tracked_items: trackedItems,
    linked_decks: linkedDeckIds.size,
    ingested_decks: ingestedDecks
  }, null, 2));
}

main();
