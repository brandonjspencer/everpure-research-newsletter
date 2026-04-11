const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'publish', 'data');
const GROUP_KEYS = [
  'findings',
  'testing_concepts',
  'in_process',
  'initiatives_on_deck',
  'weekly_progress',
  'needs',
  'next_steps',
  'other'
];
const ITEM_ID_RE = /^(\d{2,4})\s*-\s*(.+)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function headers(meta = {}, contentType = 'application/json; charset=utf-8') {
  return {
    'content-type': contentType,
    'cache-control': 'no-store, max-age=0, must-revalidate',
    'cdn-cache-control': 'no-store',
    'netlify-cdn-cache-control': 'no-store',
    'pragma': 'no-cache',
    'expires': '0',
    'netlify-vary': 'query',
    'access-control-allow-origin': '*',
    'x-generated-at': meta.generated_at || '',
    'x-source-fetched-at': meta.source_fetched_at || '',
    'x-latest-week-date': meta.latest_week_date || '',
    'x-week-count': String(meta.week_count || 0),
    'x-deck-content-count': String(meta.deck_content_count || 0),
    'x-build-id': meta.build_id || '',
    'x-deploy-id': meta.deploy_id || ''
  };
}

function loadJson(name, fallback) {
  const filePath = path.join(DATA_DIR, name);
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function flattenItems(items, parent = null, out = []) {
  for (const item of items || []) {
    const text = item.text || '';
    const row = {
      text,
      level: item.level || 0,
      parent,
      identifier: null,
      label: text
    };
    const match = ITEM_ID_RE.exec(text);
    if (match) {
      row.identifier = match[1];
      row.label = match[2].trim();
    }
    out.push(row);
    flattenItems(item.children || [], text, out);
  }
  return out;
}

function dateToObj(value) {
  if (!value || !DATE_RE.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function objToDateString(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
  return dateObj.toISOString().slice(0, 10);
}

function shiftDateString(dateString, days) {
  const dt = dateToObj(dateString);
  if (!dt) return null;
  dt.setUTCDate(dt.getUTCDate() + days);
  return objToDateString(dt);
}

function latestWeekDate(weeks) {
  return (weeks || []).reduce((acc, week) => {
    const w = week.week_date || '';
    return (!acc || w > acc) ? w : acc;
  }, '');
}

function filterWeeks(weeks, params) {
  const since = params.since || null;
  const until = params.until || null;
  const sectionFamily = params.section_family || null;
  const deckId = params.deck_id || null;
  const query = params.q || null;
  return (weeks || []).filter((week) => {
    if (since && week.week_date < since) return false;
    if (until && week.week_date > until) return false;
    if (sectionFamily && week.section_family !== sectionFamily) return false;
    if (deckId && (((week.deck || {}).file_id) !== deckId)) return false;
    if (query) {
      const hay = JSON.stringify(week).toLowerCase();
      if (!hay.includes(String(query).toLowerCase())) return false;
    }
    return true;
  });
}

function extractFindings(weeks, group, query) {
  const targetGroups = group ? [group] : GROUP_KEYS;
  let rows = [];
  for (const week of weeks || []) {
    for (const g of targetGroups) {
      const items = (((week || {}).content_groups || {})[g]) || [];
      const flat = flattenItems(items);
      rows = rows.concat(flat.map((item) => ({
        ...item,
        week_date: week.week_date,
        record_id: week.record_id,
        group: g,
        deck: week.deck || null
      })));
    }
  }
  if (query) {
    const q = String(query).toLowerCase();
    rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(q));
  }
  return rows;
}

function buildPack(weeks, deckContentIndex, since, until) {
  const findings = extractFindings(weeks, null, null);
  const byGroup = {};
  const byId = {};
  const byLabel = {};
  for (const row of findings) {
    byGroup[row.group] = (byGroup[row.group] || 0) + 1;
    if (row.identifier) byId[row.identifier] = (byId[row.identifier] || 0) + 1;
    if (row.label) byLabel[row.label] = (byLabel[row.label] || 0) + 1;
  }
  const deckIds = [...new Set((weeks || []).map((w) => ((w.deck || {}).file_id)).filter(Boolean))].sort();
  const decksWithContent = deckIds.filter((fid) => deckContentIndex[fid]);
  const timeline = (weeks || []).map((week) => {
    const counts = {};
    let total = 0;
    for (const g of GROUP_KEYS) {
      const count = flattenItems((((week || {}).content_groups || {})[g]) || []).length;
      counts[g] = count;
      total += count;
    }
    return {
      week_date: week.week_date,
      record_id: week.record_id,
      deck_id: ((week.deck || {}).file_id) || null,
      counts,
      total_items: total
    };
  });
  const topIdentifiers = Object.entries(byId)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([identifier, count]) => ({ identifier, count }));
  const topLabels = Object.entries(byLabel)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([label, count]) => ({ label, count }));
  return {
    generated_at: new Date().toISOString(),
    window: { since: since || null, until: until || null },
    overview: {
      week_count: weeks.length,
      item_count: findings.length,
      deck_count: deckIds.length,
      deck_ids: deckIds,
      decks_with_content_count: decksWithContent.length,
      decks_with_content: decksWithContent,
      date_range: {
        min: weeks.length ? weeks[weeks.length - 1].week_date : null,
        max: weeks.length ? weeks[0].week_date : null
      }
    },
    group_counts: byGroup,
    top_identifiers: topIdentifiers,
    top_labels: topLabels,
    timeline
  };
}

function parseUrlPath(value) {
  if (!value) return '';
  try {
    const u = new URL(value, 'https://example.netlify.app');
    return u.pathname || '';
  } catch {
    return String(value || '');
  }
}

function normalizeRoute(value) {
  let route = String(value || '').trim();
  if (!route || route === ':splat') return '';
  route = route.replace(/^https?:\/\/[^/]+/i, '');
  route = route.replace(/^\/+(?=.)/, '');
  route = route.replace(/^\.netlify\/functions\/api\/?/, '');
  route = route.replace(/^api\/?/, '');
  route = route.replace(/^\?path=/, '');
  route = route.replace(/^\/+/, '');
  return route.replace(/\/+$/g, '');
}

function resolveRoute(event, context) {
  const params = event.queryStringParameters || {};
  const candidates = [
    params.path,
    context && context.params ? context.params.splat : null,
    event.path,
    event.rawPath,
    parseUrlPath(event.rawUrl),
    event.headers ? (event.headers['x-original-uri'] || event.headers['x-nf-original-path'] || event.headers['x-forwarded-uri']) : null
  ];
  for (const candidate of candidates) {
    const route = normalizeRoute(candidate);
    if (route || candidate === '' || candidate === '/') return route;
  }
  return '';
}

function buildFreshness(refreshManifest, weeks, decks, deckDetails, deckContent) {
  const latestWeek = latestWeekDate(weeks);
  return {
    generated_at: refreshManifest.generated_at || null,
    source_fetched_at: (((refreshManifest || {}).source || {}).fetched_at) || null,
    source_fetch_method: (((refreshManifest || {}).source || {}).fetch_method) || null,
    source_url_present: Boolean((((refreshManifest || {}).source || {}).source_url)),
    latest_week_date: latestWeek || null,
    week_count: (weeks || []).length,
    deck_count: (decks || []).length,
    deck_detail_count: (deckDetails || []).length,
    deck_content_count: (deckContent || []).length,
    build_id: process.env.BUILD_ID || null,
    deploy_id: process.env.DEPLOY_ID || null,
    commit_ref: process.env.COMMIT_REF || null,
    context: process.env.CONTEXT || null,
    site_url: process.env.URL || null
  };
}

function attachMeta(body, meta) {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return { ...body, _meta: meta };
  }
  return body;
}

function ok(body, meta) {
  return {
    statusCode: 200,
    headers: headers(meta),
    body: JSON.stringify(attachMeta(body, meta))
  };
}

function okText(text, meta, contentType = 'text/plain; charset=utf-8') {
  return {
    statusCode: 200,
    headers: headers(meta, contentType),
    body: text
  };
}

function notFound(route, meta) {
  return {
    statusCode: 404,
    headers: headers(meta),
    body: JSON.stringify({ error: 'not_found', route, _meta: meta })
  };
}

function deriveWindowBounds(params, weeks) {
  const latest = params.until || latestWeekDate(weeks) || objToDateString(new Date());
  let until = latest;
  if (!DATE_RE.test(until)) until = latestWeekDate(weeks) || objToDateString(new Date());

  let since = params.since || null;
  const rawWindow = String(params.window || '90d').toLowerCase();
  let days = 90;
  const match = rawWindow.match(/^(\d{1,3})d$/);
  if (match) days = Number(match[1]);
  else if (rawWindow === 'month' || rawWindow === '30') days = 30;
  else if (rawWindow === 'quarter' || rawWindow === '90') days = 90;
  else if (rawWindow === '60' || rawWindow === '60d') days = 60;
  if (!since || !DATE_RE.test(since)) {
    since = shiftDateString(until, -(days - 1));
  }
  return { since, until, window_label: `${days}d`, days };
}

function safeLower(text) {
  return String(text || '').toLowerCase();
}

function isFillerLabel(label) {
  const low = safeLower(label);
  return [
    '',
    '🧠 view findings deck',
    '👉 view google doc',
    'view deck',
    'view findings deck',
    'weekly findings',
    'test findings',
    'recommendations:',
    'concept build:',
    'for next week:',
    'next week’s agenda',
    'next week\'s agenda',
    'links',
    'homework:'
  ].includes(low);
}

function sentenceCase(text) {
  const value = String(text || '').trim();
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function truncate(text, limit = 240) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).trim()}…`;
}

function firstUsefulDeckSentence(deck) {
  const text = String((deck || {}).text_excerpt || (deck || {}).full_text || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const parts = text.split(/(?<=[.!?])\s+/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.length >= 40 && safeLower(part) !== 'google slides') return truncate(part, 220);
  }
  return truncate(text, 220);
}

function collectGroupRows(weeks, group) {
  const rows = [];
  for (const week of weeks || []) {
    const items = (((week || {}).content_groups || {})[group]) || [];
    for (const item of flattenItems(items)) {
      rows.push({
        week_date: week.week_date,
        record_id: week.record_id,
        deck_id: ((week.deck || {}).file_id) || null,
        ...item
      });
    }
  }
  return rows;
}

function topGroupRows(weeks, group, limit = 8) {
  const counts = new Map();
  for (const row of collectGroupRows(weeks, group)) {
    const key = row.identifier ? `${row.identifier}|${row.label}` : row.label;
    if (!row.label || isFillerLabel(row.label)) continue;
    if (!counts.has(key)) counts.set(key, { label: row.label, identifier: row.identifier, count: 0, latest_week_date: row.week_date });
    const current = counts.get(key);
    current.count += 1;
    if ((row.week_date || '') > (current.latest_week_date || '')) current.latest_week_date = row.week_date;
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || (b.latest_week_date || '').localeCompare(a.latest_week_date || ''))
    .slice(0, limit);
}

function chooseWeeklyHighlights(weeks) {
  const rows = [];
  const priority = ['findings', 'testing_concepts', 'in_process', 'weekly_progress', 'initiatives_on_deck', 'next_steps', 'other'];
  for (const week of weeks || []) {
    let picked = [];
    for (const group of priority) {
      const items = flattenItems((((week || {}).content_groups || {})[group]) || [])
        .filter((item) => item.level <= 1 && item.label && !isFillerLabel(item.label));
      for (const item of items) {
        picked.push({ group, text: item.text, label: item.label, identifier: item.identifier || null });
        if (picked.length >= 2) break;
      }
      if (picked.length >= 2) break;
    }
    rows.push({
      week_date: week.week_date,
      record_id: week.record_id,
      deck_id: ((week.deck || {}).file_id) || null,
      highlights: picked
    });
  }
  return rows;
}

function buildExecutiveSummary(windowedWeeks, pack, deckContentIndex) {
  const topId = (pack.top_identifiers || []).slice(0, 3).map((row) => row.identifier).filter(Boolean);
  const topTesting = topGroupRows(windowedWeeks, 'testing_concepts', 3).map((row) => row.label);
  const topInProgress = topGroupRows(windowedWeeks, 'in_process', 3).map((row) => row.label);
  const deckIds = [...new Set(windowedWeeks.map((week) => ((week.deck || {}).file_id)).filter(Boolean))];
  const withDeckText = deckIds.filter((id) => deckContentIndex[id]);

  const parts = [];
  parts.push(`Across ${pack.overview.week_count} weekly updates, the strongest activity centered on ${Object.entries(pack.group_counts || {}).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([g]) => g.replace(/_/g, ' ')).join(' and ')}.`);
  if (topId.length) parts.push(`Recurring concept IDs included ${topId.join(', ')}, suggesting repeated iteration rather than one-off studies.`);
  if (topTesting.length) parts.push(`The most visible testing threads were ${topTesting.slice(0, 3).join('; ')}.`);
  if (topInProgress.length) parts.push(`In-progress work emphasized ${topInProgress.slice(0, 3).join('; ')}.`);
  if (withDeckText.length) parts.push(`${withDeckText.length} linked decks in this window currently have ingested text available for evidence-backed summarization.`);
  return parts.join(' ');
}

function buildDeckBackedInsights(windowedWeeks, deckContentIndex, limit = 6) {
  const seen = new Set();
  const insights = [];
  for (const week of windowedWeeks) {
    const fileId = ((week.deck || {}).file_id) || null;
    if (!fileId || seen.has(fileId) || !deckContentIndex[fileId]) continue;
    seen.add(fileId);
    const deck = deckContentIndex[fileId];
    insights.push({
      week_date: week.week_date,
      file_id: fileId,
      page_count: deck.page_count || null,
      total_chars: deck.total_chars || null,
      excerpt: firstUsefulDeckSentence(deck),
      canonical_url: deck.canonical_url || ((week.deck || {}).url) || null
    });
    if (insights.length >= limit) break;
  }
  return insights;
}

function buildNewsletter(windowedWeeks, deckContentIndex, bounds) {
  const pack = buildPack(windowedWeeks, deckContentIndex, bounds.since, bounds.until);
  const recurringThemes = topGroupRows(windowedWeeks, 'testing_concepts', 6).map((row) => ({
    type: 'testing_concept',
    label: row.label,
    identifier: row.identifier || null,
    mentions: row.count,
    latest_week_date: row.latest_week_date
  })).concat(topGroupRows(windowedWeeks, 'findings', 4).map((row) => ({
    type: 'finding',
    label: row.label,
    identifier: row.identifier || null,
    mentions: row.count,
    latest_week_date: row.latest_week_date
  })));

  const inProgress = topGroupRows(windowedWeeks, 'in_process', 6).map((row) => ({
    label: row.label,
    identifier: row.identifier || null,
    mentions: row.count,
    latest_week_date: row.latest_week_date
  }));

  const weeklyHighlights = chooseWeeklyHighlights(windowedWeeks);
  const deckBackedInsights = buildDeckBackedInsights(windowedWeeks, deckContentIndex, 6);
  const recommendations = [];
  if (recurringThemes.length) recommendations.push(`Prioritize follow-up synthesis around ${recurringThemes.slice(0, 3).map((row) => row.label).join(', ')} since they recur across multiple weeks.`);
  if (inProgress.length) recommendations.push(`Call out ${inProgress.slice(0, 2).map((row) => row.label).join(' and ')} as active workstreams to watch in the next issue.`);
  if (deckBackedInsights.length < recurringThemes.length) recommendations.push('Increase deck coverage or export completeness so repeated themes can be backed by deck text more consistently.');

  const topFindings = extractFindings(windowedWeeks, null, null)
    .filter((row) => row.level <= 1 && row.label && !isFillerLabel(row.label))
    .slice(0, 20);

  const keyFindings = [];
  const seenFindings = new Set();
  for (const row of topFindings) {
    const key = `${row.group}|${row.identifier || ''}|${row.label}`;
    if (seenFindings.has(key)) continue;
    seenFindings.add(key);
    keyFindings.push({
      week_date: row.week_date,
      group: row.group,
      identifier: row.identifier || null,
      label: row.label,
      deck_id: ((row.deck || {}).file_id) || null
    });
    if (keyFindings.length >= 8) break;
  }

  return {
    generated_at: new Date().toISOString(),
    window: { since: bounds.since, until: bounds.until, label: bounds.window_label, days: bounds.days },
    overview: pack.overview,
    executive_summary: buildExecutiveSummary(windowedWeeks, pack, deckContentIndex),
    section_counts: pack.group_counts,
    recurring_themes: recurringThemes,
    key_findings: keyFindings,
    in_progress: inProgress,
    deck_backed_insights: deckBackedInsights,
    weekly_highlights: weeklyHighlights,
    recommendations,
    source_record_ids: windowedWeeks.map((week) => week.record_id),
    source_deck_ids: [...new Set(windowedWeeks.map((week) => ((week.deck || {}).file_id)).filter(Boolean))]
  };
}

function renderNewsletterMarkdown(newsletter) {
  const lines = [];
  lines.push(`# Everpure Research Newsletter (${newsletter.window.label})`);
  lines.push('');
  lines.push(`_Generated: ${newsletter.generated_at}_`);
  lines.push(`_Window: ${newsletter.window.since} to ${newsletter.window.until}_`);
  lines.push('');
  lines.push('## Executive summary');
  lines.push(newsletter.executive_summary || 'No summary available.');
  lines.push('');
  lines.push('## Snapshot');
  lines.push(`- Weeks covered: ${newsletter.overview.week_count}`);
  lines.push(`- Items surfaced: ${newsletter.overview.item_count}`);
  lines.push(`- Decks linked: ${newsletter.overview.deck_count}`);
  lines.push(`- Decks with ingested text: ${newsletter.overview.decks_with_content_count}`);
  lines.push('');
  lines.push('## Recurring themes');
  if ((newsletter.recurring_themes || []).length) {
    for (const row of newsletter.recurring_themes) {
      const ident = row.identifier ? ` (${row.identifier})` : '';
      lines.push(`- ${row.label}${ident} — mentioned ${row.mentions} time(s), latest ${row.latest_week_date}`);
    }
  } else {
    lines.push('- No recurring themes identified in this window.');
  }
  lines.push('');
  lines.push('## Key findings and notable work');
  if ((newsletter.key_findings || []).length) {
    for (const row of newsletter.key_findings) {
      const ident = row.identifier ? ` (${row.identifier})` : '';
      lines.push(`- ${row.week_date}: ${row.label}${ident} [${row.group}]`);
    }
  } else {
    lines.push('- No key findings captured.');
  }
  lines.push('');
  lines.push('## In progress');
  if ((newsletter.in_progress || []).length) {
    for (const row of newsletter.in_progress) {
      const ident = row.identifier ? ` (${row.identifier})` : '';
      lines.push(`- ${row.label}${ident} — mentioned ${row.mentions} time(s)`);
    }
  } else {
    lines.push('- No in-progress items surfaced.');
  }
  lines.push('');
  lines.push('## Deck-backed evidence');
  if ((newsletter.deck_backed_insights || []).length) {
    for (const row of newsletter.deck_backed_insights) {
      lines.push(`- ${row.week_date} / ${row.file_id}: ${row.excerpt || 'Deck text available.'}`);
    }
  } else {
    lines.push('- No ingested deck text available for this window.');
  }
  lines.push('');
  lines.push('## Weekly highlights');
  if ((newsletter.weekly_highlights || []).length) {
    for (const week of newsletter.weekly_highlights) {
      const items = (week.highlights || []).map((row) => sentenceCase(row.label)).filter(Boolean);
      lines.push(`- ${week.week_date}: ${items.join('; ') || 'No clear highlight extracted.'}`);
    }
  } else {
    lines.push('- No weekly highlights available.');
  }
  lines.push('');
  lines.push('## Editorial recommendations');
  if ((newsletter.recommendations || []).length) {
    for (const row of newsletter.recommendations) lines.push(`- ${row}`);
  } else {
    lines.push('- No recommendations generated.');
  }
  return lines.join('\n');
}

exports.handler = async (event, context) => {
  const params = event.queryStringParameters || {};
  const route = resolveRoute(event, context);
  const metadata = loadJson('metadata.json', {});
  const weeks = loadJson('weeks.json', []);
  const decks = loadJson('decks.json', []);
  const summary = loadJson('summary.json', {});
  const deckSummary = loadJson('deck_summary.json', {});
  const deckDetails = loadJson('deck_details.json', []);
  const deckContent = loadJson('deck_content.json', []);
  const deckContentSummary = loadJson('deck_content_summary.json', {});
  const refreshManifest = loadJson('refresh_manifest.json', {});
  const deckContentIndex = Object.fromEntries((deckContent || []).filter((d) => d && d.file_id).map((d) => [d.file_id, d]));
  const freshness = buildFreshness(refreshManifest, weeks, decks, deckDetails, deckContent);

  if (!route || route === 'health') {
    return ok({ ok: true, route }, freshness);
  }
  if (route === 'status') return ok({ ok: true, route: 'status' }, freshness);
  if (route === 'metadata') return ok(metadata, freshness);
  if (route === 'decks') return ok(decks, freshness);
  if (route === 'deck-summary') return ok({ deck_summary: deckSummary, deck_content_summary: deckContentSummary }, freshness);
  if (route === 'deck-details') return ok(deckDetails, freshness);
  if (route.startsWith('deck-details/')) {
    const fileId = route.split('/')[1] || '';
    const row = deckDetails.find((d) => d.file_id === fileId);
    return row ? ok(row, freshness) : notFound(route, freshness);
  }
  if (route === 'deck-content') {
    if (params.file_id) {
      return ok(deckContentIndex[params.file_id] || null, freshness);
    }
    return ok(deckContent, freshness);
  }
  if (route === 'weeks') {
    return ok(filterWeeks(weeks, params), freshness);
  }
  if (route === 'findings') {
    const filteredWeeks = filterWeeks(weeks, params);
    return ok(extractFindings(filteredWeeks, params.group || null, params.q || null), freshness);
  }
  if (route === 'summary') {
    const filteredWeeks = filterWeeks(weeks, params);
    return ok(buildPack(filteredWeeks, deckContentIndex, params.since || null, params.until || null), freshness);
  }
  if (route === 'newsletter' || route === 'newsletter.md') {
    const bounds = deriveWindowBounds(params, weeks);
    const filteredWeeks = filterWeeks(weeks, { ...params, since: bounds.since, until: bounds.until });
    const newsletter = buildNewsletter(filteredWeeks, deckContentIndex, bounds);
    if (route === 'newsletter.md' || safeLower(params.format) === 'markdown' || safeLower(params.output) === 'markdown') {
      return okText(renderNewsletterMarkdown(newsletter), freshness, 'text/markdown; charset=utf-8');
    }
    return ok(newsletter, freshness);
  }
  if (route === 'static-summary') return ok(summary, freshness);
  return notFound(route, freshness);
};
