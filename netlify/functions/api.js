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

function headers() {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=60',
    'access-control-allow-origin': '*'
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

function ok(body) {
  return { statusCode: 200, headers: headers(), body: JSON.stringify(body) };
}

function notFound(route) {
  return { statusCode: 404, headers: headers(), body: JSON.stringify({ error: 'not_found', route }) };
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const route = String(params.path || '').replace(/^\/+|\/+$/g, '');
  const metadata = loadJson('metadata.json', {});
  const weeks = loadJson('weeks.json', []);
  const decks = loadJson('decks.json', []);
  const summary = loadJson('summary.json', {});
  const deckSummary = loadJson('deck_summary.json', {});
  const deckDetails = loadJson('deck_details.json', []);
  const deckContent = loadJson('deck_content.json', []);
  const deckContentSummary = loadJson('deck_content_summary.json', {});
  const deckContentIndex = Object.fromEntries(deckContent.filter((d) => d.file_id).map((d) => [d.file_id, d]));

  if (!route || route === 'health') {
    return ok({
      ok: true,
      week_count: weeks.length,
      deck_count: decks.length,
      deck_detail_count: deckDetails.length,
      deck_content_count: deckContent.length
    });
  }
  if (route === 'metadata') return ok(metadata);
  if (route === 'decks') return ok(decks);
  if (route === 'deck-summary') return ok({ deck_summary: deckSummary, deck_content_summary: deckContentSummary });
  if (route === 'deck-details') return ok(deckDetails);
  if (route.startsWith('deck-details/')) {
    const fileId = route.split('/')[1] || '';
    const row = deckDetails.find((d) => d.file_id === fileId);
    return row ? ok(row) : notFound(route);
  }
  if (route === 'deck-content') {
    if (params.file_id) {
      return ok(deckContentIndex[params.file_id] || null);
    }
    return ok(deckContent);
  }
  if (route === 'weeks') {
    return ok(filterWeeks(weeks, params));
  }
  if (route === 'findings') {
    const filteredWeeks = filterWeeks(weeks, params);
    return ok(extractFindings(filteredWeeks, params.group || null, params.q || null));
  }
  if (route === 'summary') {
    const filteredWeeks = filterWeeks(weeks, params);
    return ok(buildPack(filteredWeeks, deckContentIndex, params.since || null, params.until || null));
  }
  if (route === 'static-summary') return ok(summary);
  return notFound(route);
};
