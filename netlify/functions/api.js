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


function buildBaseUrl(event) {
  try {
    if (event && event.rawUrl) {
      const u = new URL(event.rawUrl);
      return `${u.protocol}//${u.host}`;
    }
  } catch {}
  const headers = (event && event.headers) || {};
  const proto = headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'] || 'https';
  const host = headers['host'] || headers['Host'] || null;
  if (host) return `${proto}://${host}`;
  return process.env.URL || process.env.DEPLOY_URL || '';
}

function buildDiscovery(baseUrl) {
  const rel = {
    status: '/api/status',
    health: '/api/health',
    weeks: '/api/weeks',
    summary: '/api/summary',
    newsletter_default: '/api/newsletter-default',
    newsletter_default_markdown: '/api/newsletter-default.md',
    newsletter_marketing_activity_30d: '/api/newsletter-marketing-activity-30d',
    newsletter_marketing_activity_30d_markdown: '/api/newsletter-marketing-activity-30d.md',
    newsletter_static_index: '/newsletter/',
    newsletter_static_default_json: '/newsletter/default.json',
    newsletter_static_default_markdown: '/newsletter/default.md',
    newsletter_static_default_html: '/newsletter/default.html',
    newsletter_static_marketing_json: '/newsletter/marketing-activity-30d.json',
    newsletter_static_marketing_markdown: '/newsletter/marketing-activity-30d.md',
    newsletter_static_marketing_html: '/newsletter/marketing-activity-30d.html'
  };
  const abs = {};
  const root = String(baseUrl || '').replace(/\/$/, '');
  for (const [k, v] of Object.entries(rel)) {
    abs[k] = root ? `${root}${v}` : v;
  }
  return { relative: rel, absolute: abs };
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
  const rawWindow = String(params.window || '30d').toLowerCase();
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

function deckSentenceLooksBoilerplate(text) {
  const low = safeLower(text);
  return [
    'google slides',
    'all rights reserved',
    'copyright',
    'confidential and proprietary',
    'this material',
    'this presentation',
    'do not distribute',
    'for internal use only'
  ].some((snippet) => low.includes(snippet));
}

function firstUsefulDeckSentence(deck) {
  const text = String((deck || {}).text_excerpt || (deck || {}).full_text || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const parts = text.split(/(?<=[.!?])\s+/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.length >= 50 && !deckSentenceLooksBoilerplate(part)) return truncate(part, 220);
  }
  const fallback = parts.find((part) => part.length >= 35 && !deckSentenceLooksBoilerplate(part));
  return fallback ? truncate(fallback, 220) : null;
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
    if ((row.level || 0) > 1) continue;
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
    const excerpt = firstUsefulDeckSentence(deck);
    if (!excerpt) continue;
    insights.push({
      week_date: week.week_date,
      file_id: fileId,
      page_count: deck.page_count || null,
      total_chars: deck.total_chars || null,
      excerpt,
      canonical_url: deck.canonical_url || ((week.deck || {}).url) || null
    });
    if (insights.length >= limit) break;
  }
  return insights;
}

function normalizeAudience(value) {
  const v = safeLower(value);
  if (['exec', 'executive', 'leadership'].includes(v)) return 'exec';
  if (['ux', 'research', 'uxr'].includes(v)) return 'ux';
  if (['product', 'pm'].includes(v)) return 'product';
  if (['marketing', 'web', 'content'].includes(v)) return 'marketing';
  return 'marketing';
}

function normalizeTone(value) {
  const v = safeLower(value);
  if (['brief', 'concise'].includes(v)) return 'brief';
  if (['strategic', 'leadership'].includes(v)) return 'strategic';
  if (['detailed', 'deep'].includes(v)) return 'detailed';
  return 'strategic';
}

function audienceSectionTitles(audience) {
  const titles = {
    exec: {
      top_findings: 'What leadership should know',
      recurring_themes: 'Cross-study signals',
      in_progress: 'Workstreams to watch',
      recommended_highlights: 'What to feature in the issue'
    },
    ux: {
      top_findings: 'Key research findings',
      recurring_themes: 'Patterns across studies',
      in_progress: 'Active studies and follow-ups',
      recommended_highlights: 'Recommended research callouts'
    },
    product: {
      top_findings: 'Product-relevant findings',
      recurring_themes: 'Signals that may affect decisions',
      in_progress: 'Active product-adjacent work',
      recommended_highlights: 'What to surface for product partners'
    },
    marketing: {
      top_findings: 'What we learned',
      recurring_themes: 'Themes across recent research',
      in_progress: 'What is still in motion',
      recommended_highlights: 'What to feature in the newsletter'
    }
  };
  return titles[audience] || titles.marketing;
}

function traceRef(weekDate, deckId, recordId) {
  return {
    week_date: weekDate || null,
    deck_id: deckId || null,
    record_id: recordId || null
  };
}

function formatImplication(audience, row) {
  if (audience === 'exec') return `This theme recurred ${row.mentions} time(s), making it a strong candidate for leadership-level visibility and prioritization.`;
  if (audience === 'ux') return `This theme appeared ${row.mentions} time(s), suggesting repeated validation or unresolved design questions worth further synthesis.`;
  if (audience === 'product') return `This signal appeared ${row.mentions} time(s), which may indicate a decision, taxonomy, or flow issue worth follow-up.`;
  return `This topic appeared ${row.mentions} time(s), making it a strong candidate for newsletter emphasis and stakeholder alignment.`;
}

function buildTopFindings(windowedWeeks, limit = 6) {
  const rows = extractFindings(windowedWeeks, null, null)
    .filter((row) => row.level <= 1 && row.label && !isFillerLabel(row.label));
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.group}|${row.identifier || ''}|${row.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      headline: row.identifier ? `${row.identifier} — ${sentenceCase(row.label)}` : sentenceCase(row.label),
      group: row.group,
      summary: `${sentenceCase(row.label)} appeared in the ${row.group.replace(/_/g, ' ')} stream for ${row.week_date}.`,
      source_refs: [traceRef(row.week_date, ((row.deck || {}).file_id) || null, row.record_id)]
    });
    if (out.length >= limit) break;
  }
  return out;
}

function buildRecurringThemes(windowedWeeks, audience, limit = 6) {
  const rows = topGroupRows(windowedWeeks, 'testing_concepts', 4).map((row) => ({ ...row, type: 'testing_concept' }))
    .concat(topGroupRows(windowedWeeks, 'findings', 4).map((row) => ({ ...row, type: 'finding' })))
    .slice(0, limit);
  return rows.map((row) => ({
    theme: row.identifier ? `${row.identifier} — ${sentenceCase(row.label)}` : sentenceCase(row.label),
    type: row.type,
    mentions: row.count,
    implication: formatImplication(audience, row),
    source_refs: collectGroupRows(windowedWeeks, row.type === 'testing_concept' ? 'testing_concepts' : 'findings')
      .filter((r) => r.label === row.label)
      .slice(0, 3)
      .map((r) => traceRef(r.week_date, r.deck_id, r.record_id))
  }));
}

function buildInProgress(windowedWeeks, audience, limit = 6) {
  return topGroupRows(windowedWeeks, 'in_process', limit).map((row) => ({
    workstream: row.identifier ? `${row.identifier} — ${sentenceCase(row.label)}` : sentenceCase(row.label),
    mentions: row.count,
    note: audience === 'exec'
      ? 'Still active across the reporting window and worth monitoring in the next issue.'
      : 'Still active in the current reporting window and should be carried into the next newsletter issue.',
    source_refs: collectGroupRows(windowedWeeks, 'in_process')
      .filter((r) => r.label === row.label)
      .slice(0, 3)
      .map((r) => traceRef(r.week_date, r.deck_id, r.record_id))
  }));
}

function buildRecommendedHighlights(windowedWeeks, audience, limit = 6) {
  const weekly = chooseWeeklyHighlights(windowedWeeks).filter((w) => (w.highlights || []).length);
  const out = [];
  for (const week of weekly) {
    const primary = week.highlights[0];
    if (!primary) continue;
    out.push({
      title: primary.identifier ? `${primary.identifier} — ${sentenceCase(primary.label)}` : sentenceCase(primary.label),
      angle: audience === 'exec'
        ? `Use this as a concise signal of recent movement in the research stream for ${week.week_date}.`
        : audience === 'product'
          ? `Use this to show product-adjacent movement during the week of ${week.week_date}.`
          : audience === 'ux'
            ? `Use this as a representative research highlight from the week of ${week.week_date}.`
            : `Use this as a newsletter highlight from the week of ${week.week_date}.`,
      support: week.highlights.map((h) => sentenceCase(h.label)).join('; '),
      source_refs: [traceRef(week.week_date, week.deck_id, week.record_id)]
    });
    if (out.length >= limit) break;
  }
  return out;
}

function buildEditorialRecommendations(strategicThemes, validatedFindings, workstreamsToWatch, deckBackedInsights, audience, mode, comparisonTests, shipRecommendations) {
  const recommendations = [];
  if (mode === 'activity_log') {
    recommendations.push('Lead with cadence and volume first so stakeholders can see how consistently the research program is operating.');
    recommendations.push('Use a week-by-week log after the opening summary to make the monthly research rhythm visible.');
    recommendations.push('Keep concept IDs in the marketing activity view where they help show throughput and testing volume.');
    return recommendations;
  }
  if (!shipRecommendations.length) recommendations.push('Say explicitly that the strongest evidence supports iteration, not an immediate ship decision, when that is the truth of the month.');
  if (comparisonTests.length) recommendations.push('Give comparison-style work its own section so baseline and variation results are easier to interpret.');
  if (validatedFindings.length) recommendations.push('Keep confirmed findings separate from exploratory concepts so the issue reads as a decision brief instead of a raw activity log.');
  if (workstreamsToWatch.length) recommendations.push(`Reserve a short “watch next” section for ${workstreamsToWatch.slice(0, 2).map((row) => row.workstream).join(' and ')}.`);
  if (deckBackedInsights.length) recommendations.push('Use deck-backed evidence only when the excerpt adds a concrete insight, not when it repeats document boilerplate.');
  if (audience === 'exec') recommendations.push('Keep internal concept IDs in source references, but remove them from the main narrative wherever possible.');
  return recommendations;
}



function buildAudienceHeadline(audience, bounds) {
  const map = {
    exec: 'Everpure research leadership brief',
    ux: 'Everpure UX research digest',
    product: 'Everpure product insight digest',
    marketing: 'Everpure research newsletter draft'
  };
  return `${map[audience] || map.marketing} (${bounds.window_label})`;
}


function resolveNewsletterOptions(params = {}) {
  const preset = safeLower(params.preset || params.variant || '');
  const options = {
    preset: preset || null,
    audience: normalizeAudience(params.audience || 'exec'),
    tone: normalizeTone(params.tone || 'strategic'),
    mode: safeLower(params.mode || 'strategic_digest') || 'strategic_digest',
    window: params.window || '30d'
  };

  if (!params.window) options.window = '30d';
  if (!params.audience) options.audience = 'exec';
  if (!params.tone) options.tone = 'strategic';

  if (preset === 'default_exec_monthly' || preset === 'exec_monthly') {
    options.audience = 'exec';
    options.tone = 'strategic';
    options.window = '30d';
    options.mode = 'strategic_digest';
  }
  if (preset === 'marketing_activity_30d' || preset === 'marketing_log') {
    options.audience = 'marketing';
    options.tone = 'detailed';
    options.window = '30d';
    options.mode = 'activity_log';
  }
  if (options.audience === 'marketing' && !params.mode && options.tone === 'detailed') {
    options.mode = 'activity_log';
  }
  return options;
}

function inferThemeBucket(label) {
  const low = safeLower(label);
  const buckets = [
    ['navigation_and_cta_clarity', ['navigation', 'nav', 'cta', 'label', 'menu', 'pathfinder', 'journey']],
    ['homepage_and_message_clarity', ['homepage', 'headline', 'messaging', 'message', 'reader', 'search page', 'header', 'landing page']],
    ['knowledge_portal_and_platform_structure', ['knowledge portal', 'platform', 'taxonomy', 'support', 'flow', 'search', 'reader']],
    ['event_and_launch_experiences', ['event', 'launch', 'webinar', 'accelerate']],
    ['brand_and_rebrand_signals', ['brand', 'rebrand', 'evergreen', 'score', 'inspiration']],
    ['comparison_and_evaluation_behavior', ['comparison', 'compare', 'baseline', 'competitive', 'assessment', 'review']],
    ['ai_and_personalization', ['ai', 'personalization', 'summary']]
  ];
  for (const [bucket, terms] of buckets) {
    if (terms.some((term) => low.includes(term))) return bucket;
  }
  return 'general_research_signal';
}

function themeBucketLabel(bucket) {
  const labels = {
    navigation_and_cta_clarity: 'Navigation and CTA clarity',
    homepage_and_message_clarity: 'Homepage and message clarity',
    knowledge_portal_and_platform_structure: 'Knowledge portal and platform structure',
    event_and_launch_experiences: 'Event and launch experiences',
    brand_and_rebrand_signals: 'Brand and rebrand signals',
    comparison_and_evaluation_behavior: 'Comparison and evaluation behavior',
    ai_and_personalization: 'AI and personalization',
    general_research_signal: 'Emerging research priorities'
  };
  return labels[bucket] || sentenceCase(bucket.replace(/_/g, ' '));
}

function collectNonFillerRows(windowedWeeks, groups = GROUP_KEYS) {
  return extractFindings(windowedWeeks, null, null)
    .filter((row) => groups.includes(row.group) && row.level <= 1 && row.label && !isFillerLabel(row.label));
}

function cleanNarrativeLabel(label) {
  let text = String(label || '').trim();
  text = text.replace(/^baselines?:\s*/i, '');
  text = text.replace(/\((?:in process|internal|received)\)/ig, '');
  text = text.replace(/\bCTA\b/g, 'call-to-action');
  text = text.replace(/\s*:\s*$/g, '');
  text = text.replace(/\s+/g, ' ').trim();
  return sentenceCase(text);
}

function comparisonLike(text) {
  const low = safeLower(text);
  return /(\bv\d+\b|\br\d+\b|\bvariation\b|\bvariations\b|\bbaseline\b|\bcomparison\b|\bcompare\b|\breview\b|\banalysis\b|\bcompetitive\b)/.test(low);
}

function decisionStatusFor(group, label, count) {
  const low = safeLower(label);
  if (group === 'in_process') return 'watch';
  if (group === 'testing_concepts') return comparisonLike(low) ? 'watch' : 'iterate';
  if (group === 'findings') {
    if (/(baseline|variation|variations|review|analysis|feedback|summary)/.test(low)) return 'iterate';
    if (count >= 2 && !comparisonLike(low)) return 'ship';
    return 'iterate';
  }
  return 'watch';
}

function confidenceLevelFor(group, label, count, hasDeckEvidence = false) {
  const low = safeLower(label);
  if (group === 'findings') {
    if (count >= 2 && hasDeckEvidence && !comparisonLike(low)) return 'high';
    if (count >= 1) return 'medium';
  }
  if (group === 'testing_concepts') return count >= 2 ? 'medium' : 'low';
  if (group === 'in_process') return count >= 2 ? 'medium' : 'low';
  return 'low';
}

function bucketFocusSentence(bucket) {
  const map = {
    navigation_and_cta_clarity: 'Users still appear to need clearer navigation and next-step cues.',
    homepage_and_message_clarity: 'Homepage and messaging comprehension remain active decision areas.',
    knowledge_portal_and_platform_structure: 'Information architecture and discoverability are still being worked through.',
    event_and_launch_experiences: 'Event and launch experiences are producing concrete directional signal.',
    brand_and_rebrand_signals: 'Brand and rebrand work is producing clearer directional feedback.',
    comparison_and_evaluation_behavior: 'Comparative work is beginning to show which variants are stronger.',
    ai_and_personalization: 'AI-related messaging is surfacing as a clarity and positioning issue.',
    general_research_signal: 'This adds signal, but not yet enough for a broad decision.'
  };
  return map[bucket] || map.general_research_signal;
}

function decisionMessage(decision) {
  const map = {
    ship: 'Confidence is strong enough to ship the change without another round of validation.',
    iterate: 'The signal is useful, but it points to another iteration rather than an immediate ship call.',
    hold: 'Hold this area until stronger evidence is available.',
    watch: 'Keep this visible as an emerging area, but do not treat it as decision-ready yet.'
  };
  return map[decision] || map.watch;
}

function confidenceMessage(level) {
  const map = {
    high: 'High confidence',
    medium: 'Moderate confidence',
    low: 'Directional signal only'
  };
  return map[level] || 'Directional signal only';
}

function buildSourceRefsForLabel(windowedWeeks, group, label, limit = 3) {
  return collectGroupRows(windowedWeeks, group)
    .filter((r) => r.label === label)
    .slice(0, limit)
    .map((r) => traceRef(r.week_date, r.deck_id, r.record_id));
}

function collectComparisonCandidates(windowedWeeks, limit = 5) {
  const rows = [];
  for (const week of windowedWeeks || []) {
    for (const group of ['findings', 'testing_concepts']) {
      for (const item of ((((week || {}).content_groups || {})[group]) || [])) {
        const baseMatch = ITEM_ID_RE.exec(item.text || '');
        const baseLabel = cleanNarrativeLabel(baseMatch ? baseMatch[2] : item.text || '');
        const childLabels = flattenItems(item.children || []).map((child) => cleanNarrativeLabel(child.label || child.text || ''));
        const joinedChildren = childLabels.join(' ');
        if (!comparisonLike(baseLabel) && !comparisonLike(joinedChildren)) continue;
        rows.push({
          group,
          week_date: week.week_date,
          record_id: week.record_id,
          deck_id: ((week.deck || {}).file_id) || null,
          label: baseLabel,
          identifier: baseMatch ? baseMatch[1] : null,
          child_labels: childLabels
        });
      }
    }
  }
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.group}|${row.label}`;
    if (!grouped.has(key)) grouped.set(key, { ...row, mentions: 0, source_refs: [] });
    const current = grouped.get(key);
    current.mentions += 1;
    if (row.child_labels.length && !current.child_labels.length) current.child_labels = row.child_labels;
    if (current.source_refs.length < 3) current.source_refs.push(traceRef(row.week_date, row.deck_id, row.record_id));
    if ((row.week_date || '') > (current.week_date || '')) current.week_date = row.week_date;
  }
  return [...grouped.values()]
    .sort((a, b) => b.mentions - a.mentions || (b.week_date || '').localeCompare(a.week_date || ''))
    .slice(0, limit)
    .map((row) => {
      const decision_status = row.group === 'findings' ? 'iterate' : 'watch';
      const confidence_level = row.group === 'findings' ? 'medium' : (row.mentions >= 2 ? 'medium' : 'low');
      const comparison_basis = row.child_labels.length
        ? `Compared ${row.child_labels.slice(0, 3).join(' vs ')}.`
        : comparisonLike(row.label)
          ? 'This item explicitly references a baseline, review, variation, or comparison.'
          : 'This item behaves like a comparison thread.';
      return {
        test_name: row.label,
        summary: `${row.label} is one of the clearer comparison-style threads in the current window. ${comparison_basis}`,
        decision_status,
        confidence_level,
        recommendation: decisionMessage(decision_status),
        source_refs: row.source_refs,
        source_label: row.identifier || null
      };
    });
}

function buildStrategicThemeClusters(windowedWeeks, audience, limit = 5) {
  const rows = collectNonFillerRows(windowedWeeks, ['findings', 'testing_concepts', 'in_process']);
  const clusters = new Map();
  for (const row of rows) {
    const bucket = inferThemeBucket(row.label);
    if (!clusters.has(bucket)) {
      clusters.set(bucket, {
        bucket,
        theme: themeBucketLabel(bucket),
        mentions: 0,
        finding_mentions: 0,
        testing_mentions: 0,
        in_progress_mentions: 0,
        examples: [],
        refs: []
      });
    }
    const current = clusters.get(bucket);
    current.mentions += 1;
    if (row.group === 'findings') current.finding_mentions += 1;
    if (row.group === 'testing_concepts') current.testing_mentions += 1;
    if (row.group === 'in_process') current.in_progress_mentions += 1;
    if (!current.examples.includes(sentenceCase(row.label)) && current.examples.length < 4) current.examples.push(sentenceCase(row.label));
    if (current.refs.length < 4) current.refs.push(traceRef(row.week_date, ((row.deck || {}).file_id) || null, row.record_id));
  }
  return [...clusters.values()]
    .sort((a, b) => b.mentions - a.mentions || b.finding_mentions - a.finding_mentions)
    .slice(0, limit)
    .map((cluster) => ({
      theme: cluster.theme,
      mentions: cluster.mentions,
      implication: formatClusterImplication(audience, cluster),
      supporting_examples: cluster.examples,
      source_refs: cluster.refs
    }));
}

function formatClusterImplication(audience, cluster) {
  if (audience === 'exec') {
    if (cluster.finding_mentions > 0 && cluster.in_progress_mentions > 0) {
      return `This pattern combines confirmed evidence with active follow-up, which suggests a live business issue rather than a closed research thread.`;
    }
    if (cluster.finding_mentions > 1) {
      return `This pattern appears in validated findings across the month and is strong enough to shape leadership attention and prioritization.`;
    }
    return `This pattern is emerging across multiple updates and is worth monitoring in the next decision cycle.`;
  }
  if (audience === 'marketing') {
    return `This theme recurs across recent studies and can anchor how the team communicates research momentum and focus.`;
  }
  if (audience === 'product') {
    return `This theme appears often enough to suggest a decision, taxonomy, or flow issue worth product follow-up.`;
  }
  return `This theme appears repeatedly enough to merit explicit synthesis in the issue.`;
}

function buildValidatedFindings(windowedWeeks, audience, limit = 5, deckContentIndex = {}) {
  const ranked = topGroupRows(windowedWeeks, 'findings', limit * 3);
  const out = [];
  for (const row of ranked) {
    const plain = cleanNarrativeLabel(row.label);
    const bucket = inferThemeBucket(plain);
    const refs = buildSourceRefsForLabel(windowedWeeks, 'findings', row.label, 3);
    const sampleDeckId = (refs[0] || {}).deck_id || null;
    const hasDeckEvidence = Boolean(sampleDeckId && deckContentIndex[sampleDeckId]);
    const decision_status = decisionStatusFor('findings', plain, row.count);
    const confidence_level = confidenceLevelFor('findings', plain, row.count, hasDeckEvidence);
    const evidence_basis = [];
    evidence_basis.push('validated finding');
    if (row.count > 1) evidence_basis.push(`repeated in ${row.count} updates`);
    if (hasDeckEvidence) evidence_basis.push('deck-backed evidence available');
    if (comparisonLike(plain)) evidence_basis.push('comparison-style result');
    out.push({
      headline: plain,
      summary: `${plain} surfaced as a validated signal in the current 30-day window. ${bucketFocusSentence(bucket)}`,
      implication: decisionMessage(decision_status),
      decision_status,
      confidence_level,
      evidence_basis,
      source_refs: refs,
      source_label: row.identifier || null
    });
    if (out.length >= limit) break;
  }
  return out;
}



function buildEmergingSignals(windowedWeeks, audience, limit = 5) {
  return topGroupRows(windowedWeeks, 'testing_concepts', limit).map((row) => {
    const plain = cleanNarrativeLabel(row.label);
    return ({
      signal: plain,
      summary: `${plain} is still exploratory, but it is recurring often enough to show where the next research pressure is building.`,
      mentions: row.count,
      decision_status: decisionStatusFor('testing_concepts', plain, row.count),
      confidence_level: confidenceLevelFor('testing_concepts', plain, row.count),
      source_refs: buildSourceRefsForLabel(windowedWeeks, 'testing_concepts', row.label, 3),
      source_label: row.identifier || null
    });
  });
}



function buildWorkstreamsToWatch(windowedWeeks, audience, limit = 5) {
  return topGroupRows(windowedWeeks, 'in_process', limit).map((row) => {
    const plain = cleanNarrativeLabel(row.label);
    return ({
      workstream: plain,
      summary: `${plain} remained active across the month and should stay visible as a watch item rather than a finished result.`,
      mentions: row.count,
      decision_status: 'watch',
      confidence_level: confidenceLevelFor('in_process', plain, row.count),
      source_refs: buildSourceRefsForLabel(windowedWeeks, 'in_process', row.label, 3),
      source_label: row.identifier || null
    });
  });
}



function buildLeadershipImplications(strategicThemes, validatedFindings, workstreamsToWatch, audience) {
  const out = [];
  const shipReady = validatedFindings.filter((row) => row.decision_status === 'ship');
  if (!shipReady.length) {
    out.push({
      statement: 'No item in the current 30-day window rises to a clean high-confidence ship call yet.',
      rationale: 'The strongest evidence supports iteration and prioritization decisions, but not a blanket “ship now” recommendation.',
      source_refs: validatedFindings.slice(0, 2).flatMap((row) => row.source_refs || [])
    });
  }
  if (strategicThemes[0]) {
    out.push({
      statement: `${strategicThemes[0].theme} is the clearest repeating signal in the current monthly window.`,
      rationale: strategicThemes[0].implication,
      source_refs: strategicThemes[0].source_refs || []
    });
  }
  if (workstreamsToWatch[0]) {
    out.push({
      statement: `Leaders should keep ${workstreamsToWatch[0].workstream} visible as an active follow-through area.`,
      rationale: 'The monthly issue should not stop at validated findings; it should also show what is maturing next.',
      source_refs: workstreamsToWatch[0].source_refs || []
    });
  }
  return out;
}



function buildIssueHighlights(validatedFindings, strategicThemes, workstreamsToWatch, audience, limit = 4) {
  const rows = [];
  for (const row of validatedFindings.slice(0, 2)) {
    rows.push({
      title: row.headline,
      angle: row.decision_status === 'ship'
        ? 'Use this as a ship-ready callout in the opening section.'
        : 'Use this as a validated finding with a clear next-step recommendation.',
      source_refs: row.source_refs || []
    });
  }
  if (strategicThemes[0]) {
    rows.push({
      title: strategicThemes[0].theme,
      angle: 'Use this as the cross-study pattern that ties the month together.',
      source_refs: strategicThemes[0].source_refs || []
    });
  }
  if (workstreamsToWatch[0]) {
    rows.push({
      title: workstreamsToWatch[0].workstream,
      angle: 'Use this as the “watch next” item that points to what may matter in the next issue.',
      source_refs: workstreamsToWatch[0].source_refs || []
    });
  }
  return rows.slice(0, limit);
}



function buildVolumeSnapshot(windowedWeeks) {
  const perWeek = (windowedWeeks || []).map((week) => {
    const counts = {};
    let total = 0;
    for (const g of GROUP_KEYS) {
      const count = flattenItems((((week || {}).content_groups || {})[g]) || []).length;
      counts[g] = count;
      total += count;
    }
    return {
      week_date: week.week_date,
      total_items: total,
      findings: counts.findings || 0,
      testing_concepts: counts.testing_concepts || 0,
      in_process: counts.in_process || 0,
      weekly_progress: counts.weekly_progress || 0,
      deck_id: ((week.deck || {}).file_id) || null
    };
  });
  const totals = perWeek.reduce((acc, row) => {
    acc.total_items += row.total_items;
    acc.findings += row.findings;
    acc.testing_concepts += row.testing_concepts;
    acc.in_process += row.in_process;
    acc.weekly_progress += row.weekly_progress;
    return acc;
  }, { total_items: 0, findings: 0, testing_concepts: 0, in_process: 0, weekly_progress: 0 });
  return {
    week_count: perWeek.length,
    average_items_per_week: perWeek.length ? Number((totals.total_items / perWeek.length).toFixed(1)) : 0,
    totals,
    weeks: perWeek
  };
}

function buildCadenceSummary(windowedWeeks, volumeSnapshot) {
  const activeWeeks = (volumeSnapshot.weeks || []).filter((row) => row.total_items > 0).length;
  const deckWeeks = (windowedWeeks || []).filter((week) => ((week.deck || {}).file_id)).length;
  return {
    summary: `Over the last ${windowedWeeks.length} weekly entries, the research stream logged ${volumeSnapshot.totals.total_items} tracked items across findings, testing concepts, active work, and progress notes.`,
    active_weeks: activeWeeks,
    deck_linked_weeks: deckWeeks,
    average_items_per_week: volumeSnapshot.average_items_per_week
  };
}

function buildActivityLogEntries(windowedWeeks, limit = 6) {
  return chooseWeeklyHighlights(windowedWeeks).slice(0, limit).map((week) => ({
    week_date: week.week_date,
    summary: (week.highlights || []).length
      ? (week.highlights || []).map((h) => sentenceCase(h.label)).join('; ')
      : 'Activity recorded without a concise highlight.',
    source_refs: [traceRef(week.week_date, week.deck_id, week.record_id)]
  }));
}

function buildAudienceSummary(audience, tone, mode, windowedWeeks, pack, strategicThemes, validatedFindings, emergingSignals, workstreamsToWatch, volumeSnapshot, comparisonTests, shipRecommendations, iterateRecommendations) {
  if (mode === 'activity_log') {
    return `This 30-day view captures the cadence and volume of the research program: ${pack.overview.week_count} weekly updates, ${volumeSnapshot.totals.total_items} tracked items, and repeated motion across findings, concepts, and active workstreams.`;
  }
  const topTheme = strategicThemes[0] ? strategicThemes[0].theme : 'recent research activity';
  const topValidated = validatedFindings[0] ? validatedFindings[0].headline : null;
  const topComparison = comparisonTests[0] ? comparisonTests[0].test_name : null;
  const watchLead = workstreamsToWatch[0] ? workstreamsToWatch[0].workstream : null;
  const shipCount = shipRecommendations.length;
  const iterateCount = iterateRecommendations.length;
  const sentences = [];
  sentences.push(`Across ${pack.overview.week_count} weekly updates, the strongest monthly signal is ${topTheme.toLowerCase()}, not a scattered set of one-off studies.`);
  if (topValidated) sentences.push(`${topValidated} is the clearest validated finding in the current window.`);
  if (topComparison) sentences.push(`${topComparison} is one of the more meaningful comparison-style threads because it helps separate baseline signal from next-step iteration.`);
  if (!shipCount) sentences.push('The current corpus supports iteration and prioritization decisions more strongly than an immediate ship call.');
  if (watchLead) sentences.push(`${watchLead} should remain visible as an active watch item rather than be treated as resolved.`);
  if (tone === 'brief') return truncate(sentences.join(' '), 320);
  if (iterateCount) sentences.push(`${iterateCount} validated items look useful enough to iterate immediately.`);
  return sentences.join(' ');
}



function buildEditorialRecommendations(strategicThemes, validatedFindings, workstreamsToWatch, deckBackedInsights, audience, mode) {
  const recommendations = [];
  if (mode === 'activity_log') {
    recommendations.push('Lead with cadence and volume first so stakeholders can see how consistently the research program is operating.');
    recommendations.push('Use a week-by-week log after the opening summary to make the monthly research rhythm visible.');
    recommendations.push('Keep concept IDs in the marketing activity view where they help show throughput and testing volume.');
    return recommendations;
  }
  if (strategicThemes.length) recommendations.push(`Lead with ${strategicThemes.slice(0, 2).map((row) => row.theme).join(' and ')} because those are the clearest repeated patterns across the month.`);
  if (validatedFindings.length) recommendations.push('Keep confirmed findings separate from exploratory concepts so the issue reads as a leadership brief, not a raw research log.');
  if (workstreamsToWatch.length) recommendations.push(`Reserve a short “watch next” section for ${workstreamsToWatch.slice(0, 2).map((row) => row.workstream).join(' and ')}.`);
  if (deckBackedInsights.length) recommendations.push('Use at least one deck-backed excerpt to anchor a major insight in evidence rather than summary language alone.');
  if (audience === 'exec') recommendations.push('Minimize internal concept IDs in the narrative and elevate business implications instead.');
  return recommendations;
}

function buildAudienceHeadline(audience, bounds, mode) {
  if (mode === 'activity_log') return `Everpure research activity log (${bounds.window_label})`;
  const map = {
    exec: 'Everpure monthly leadership brief',
    ux: 'Everpure UX research digest',
    product: 'Everpure product insight digest',
    marketing: 'Everpure research newsletter draft'
  };
  return `${map[audience] || map.marketing} (${bounds.window_label})`;
}

function buildNewsletter(windowedWeeks, deckContentIndex, bounds, options = {}) {
  const audience = normalizeAudience(options.audience || 'exec');
  const tone = normalizeTone(options.tone || 'strategic');
  const mode = safeLower(options.mode || 'strategic_digest') || 'strategic_digest';
  const pack = buildPack(windowedWeeks, deckContentIndex, bounds.since, bounds.until);
  const deckBackedInsights = buildDeckBackedInsights(windowedWeeks, deckContentIndex, tone === 'brief' ? 3 : 6);
  const validatedFindings = buildValidatedFindings(windowedWeeks, audience, tone === 'brief' ? 3 : 5, deckContentIndex);
  const comparisonTests = collectComparisonCandidates(windowedWeeks, tone === 'brief' ? 3 : 5);
  const emergingSignals = buildEmergingSignals(windowedWeeks, audience, tone === 'brief' ? 3 : 5);
  const workstreamsToWatch = buildWorkstreamsToWatch(windowedWeeks, audience, tone === 'brief' ? 3 : 5);
  const strategicThemes = buildStrategicThemeClusters(windowedWeeks, audience, tone === 'brief' ? 3 : 5);
  const shipRecommendations = validatedFindings.filter((row) => row.decision_status === 'ship');
  const iterateRecommendations = validatedFindings.filter((row) => row.decision_status === 'iterate');
  const watchItems = [...workstreamsToWatch.slice(0, 3), ...emergingSignals.slice(0, 2)].slice(0, tone === 'brief' ? 3 : 5);
  const confidenceNotes = {
    ship_ready_count: shipRecommendations.length,
    iterate_count: iterateRecommendations.length,
    watch_count: watchItems.length,
    comparison_test_count: comparisonTests.length,
    note: shipRecommendations.length
      ? 'At least one item appears strong enough for a ship recommendation in this window.'
      : 'This month’s evidence is more useful for deciding what to iterate next than for issuing a blanket ship call.'
  };
  const leadershipImplications = buildLeadershipImplications(strategicThemes, validatedFindings, workstreamsToWatch, audience);
  const volumeSnapshot = buildVolumeSnapshot(windowedWeeks);
  const cadenceSummary = buildCadenceSummary(windowedWeeks, volumeSnapshot);
  const activityLog = buildActivityLogEntries(windowedWeeks, tone === 'brief' ? 4 : 6);
  const issueHighlights = buildIssueHighlights(validatedFindings, strategicThemes, workstreamsToWatch, audience, tone === 'brief' ? 3 : 4);
  const recommendations = buildEditorialRecommendations(strategicThemes, validatedFindings, workstreamsToWatch, deckBackedInsights, audience, mode, comparisonTests, shipRecommendations);
  const sectionTitles = audienceSectionTitles(audience);
  const topFindings = mode === 'activity_log' ? issueHighlights : validatedFindings;

  const newsletter = {
    generated_at: new Date().toISOString(),
    title: buildAudienceHeadline(audience, bounds, mode),
    audience,
    tone,
    mode,
    preset: options.preset || null,
    defaults: { window: '30d', audience: 'exec', tone: 'strategic' },
    window: { since: bounds.since, until: bounds.until, label: bounds.window_label, days: bounds.days },
    overview: pack.overview,
    executive_summary: buildAudienceSummary(audience, tone, mode, windowedWeeks, pack, strategicThemes, validatedFindings, emergingSignals, workstreamsToWatch, volumeSnapshot, comparisonTests, shipRecommendations, iterateRecommendations),
    section_counts: pack.group_counts,
    section_titles: sectionTitles,
    decision_summary: confidenceNotes,
    sections: {
      top_findings: topFindings,
      recurring_themes: strategicThemes,
      in_progress: workstreamsToWatch,
      recommended_highlights: issueHighlights,
      deck_backed_insights: deckBackedInsights,
      validated_findings: validatedFindings,
      comparison_tests: comparisonTests,
      ship_recommendations: shipRecommendations,
      iterate_recommendations: iterateRecommendations,
      watch_items: watchItems,
      confidence_notes: confidenceNotes,
      emerging_signals: emergingSignals,
      strategic_themes: strategicThemes,
      workstreams_to_watch: workstreamsToWatch,
      leadership_implications: leadershipImplications,
      cadence_summary: cadenceSummary,
      volume_snapshot: volumeSnapshot,
      activity_log: activityLog,
      activity_counts: volumeSnapshot.totals,
      weekly_cadence: cadenceSummary,
      active_workstreams: workstreamsToWatch.map((row) => ({ workstream: row.workstream, mentions: row.mentions, source_refs: row.source_refs }))
    },
    ship_recommendations: shipRecommendations,
    iterate_recommendations: iterateRecommendations,
    watch_items: watchItems,
    comparison_tests: comparisonTests,
    confidence_notes: confidenceNotes,
    recommendations,
    source_traceability: {
      record_ids: windowedWeeks.map((week) => week.record_id),
      deck_ids: [...new Set(windowedWeeks.map((week) => ((week.deck || {}).file_id)).filter(Boolean))]
    }
  };
  newsletter.draft_markdown = renderNewsletterMarkdown(newsletter);
  return newsletter;
}



function renderNewsletterMarkdown(newsletter) {
  const lines = [];
  lines.push(`# ${newsletter.title}`);
  lines.push('');
  lines.push(`_Generated: ${newsletter.generated_at}_`);
  lines.push(`_Window: ${newsletter.window.since} to ${newsletter.window.until}_`);
  lines.push(`_Audience: ${newsletter.audience} | Tone: ${newsletter.tone} | Mode: ${newsletter.mode}_`);
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

  if (newsletter.mode === 'activity_log') {
    const cadence = newsletter.sections.cadence_summary || {};
    const volume = newsletter.sections.volume_snapshot || {};
    lines.push('## Activity summary');
    lines.push(cadence.summary || 'No cadence summary available.');
    lines.push('');
    lines.push('## Volume snapshot');
    lines.push(`- Total tracked items: ${(volume.totals || {}).total_items || 0}`);
    lines.push(`- Findings: ${(volume.totals || {}).findings || 0}`);
    lines.push(`- Testing concepts: ${(volume.totals || {}).testing_concepts || 0}`);
    lines.push(`- In progress: ${(volume.totals || {}).in_process || 0}`);
    lines.push(`- Average items per week: ${volume.average_items_per_week || 0}`);
    lines.push('');
    lines.push('## Weekly activity log');
    for (const row of (newsletter.sections.activity_log || [])) {
      lines.push(`- **${row.week_date}** — ${row.summary}`);
    }
    lines.push('');
    lines.push('## Active workstreams');
    for (const row of (newsletter.sections.active_workstreams || [])) {
      lines.push(`- **${row.workstream}** — Mentioned ${row.mentions} time(s).`);
    }
  } else {
    lines.push('## What we learned this month');
    for (const row of (newsletter.sections.validated_findings || [])) {
      lines.push(`- **${row.headline}** — ${row.summary} ${row.implication}`);
    }
    lines.push('');
    lines.push('## What looks ready to ship');
    if ((newsletter.sections.ship_recommendations || []).length) {
      for (const row of newsletter.sections.ship_recommendations) {
        lines.push(`- **${row.headline}** — ${confidenceMessage(row.confidence_level)}. ${row.implication}`);
      }
    } else {
      lines.push('- No item currently reaches a clean high-confidence ship threshold from the last 30 days.');
    }
    lines.push('');
    lines.push('## What needs another iteration');
    if ((newsletter.sections.iterate_recommendations || []).length) {
      for (const row of newsletter.sections.iterate_recommendations) {
        lines.push(`- **${row.headline}** — ${confidenceMessage(row.confidence_level)}. ${row.implication}`);
      }
    } else {
      lines.push('- No immediate iterate recommendations were generated.');
    }
    lines.push('');
    lines.push('## Meaningful comparison tests');
    if ((newsletter.sections.comparison_tests || []).length) {
      for (const row of newsletter.sections.comparison_tests) {
        lines.push(`- **${row.test_name}** — ${row.summary} ${row.recommendation}`);
      }
    } else {
      lines.push('- No comparison-style tests surfaced strongly enough in this window.');
    }
    lines.push('');
    lines.push('## What leadership should focus on next');
    for (const row of (newsletter.sections.watch_items || [])) {
      const label = row.workstream || row.signal || row.headline || row.title || 'Watch item';
      const summary = row.summary || row.implication || 'Keep this visible in the next decision cycle.';
      lines.push(`- **${label}** — ${summary}`);
    }
    lines.push('');
    lines.push('## Cross-study signals');
    for (const row of (newsletter.sections.strategic_themes || [])) {
      lines.push(`- **${row.theme}** — ${row.implication}`);
    }
    lines.push('');
    lines.push('## Leadership implications');
    for (const row of (newsletter.sections.leadership_implications || [])) {
      lines.push(`- **${row.statement}** — ${row.rationale}`);
    }
  }

  lines.push('');
  lines.push('## Deck-backed evidence');
  if ((newsletter.sections.deck_backed_insights || []).length) {
    for (const row of newsletter.sections.deck_backed_insights) {
      lines.push(`- **${row.week_date} / ${row.file_id}** — ${row.excerpt}`);
    }
  } else {
    lines.push('- No deck-backed excerpts available in the current output.');
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
  const baseUrl = buildBaseUrl(event);
  const discovery = buildDiscovery(baseUrl);
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
    return ok({ ok: true, route, defaults: { window: '30d', audience: 'exec', tone: 'strategic' }, discovery }, freshness);
  }
  if (route === 'status') return ok({ ok: true, route: 'status', defaults: { window: '30d', audience: 'exec', tone: 'strategic' }, discovery }, freshness);
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
  const newsletterAliases = {
    'newsletter-default': { preset: 'default_exec_monthly' },
    'newsletter-default.md': { preset: 'default_exec_monthly' },
    'newsletter-marketing-activity-30d': { preset: 'marketing_activity_30d' },
    'newsletter-marketing-activity-30d.md': { preset: 'marketing_activity_30d' }
  };
  if (newsletterAliases[route]) {
    const mergedParams = { ...params, ...newsletterAliases[route] };
    const newsletterOptions = resolveNewsletterOptions(mergedParams);
    const bounds = deriveWindowBounds({ ...mergedParams, window: newsletterOptions.window }, weeks);
    const filteredWeeks = filterWeeks(weeks, { ...mergedParams, since: bounds.since, until: bounds.until });
    const newsletter = buildNewsletter(filteredWeeks, deckContentIndex, bounds, newsletterOptions);
    if (route.endsWith('.md') || safeLower(params.format) === 'markdown' || safeLower(params.output) === 'markdown') {
      return okText(renderNewsletterMarkdown(newsletter), freshness, 'text/markdown; charset=utf-8');
    }
    return ok(newsletter, freshness);
  }
  if (route === 'newsletter' || route === 'newsletter.md') {
    const newsletterOptions = resolveNewsletterOptions(params);
    const bounds = deriveWindowBounds({ ...params, window: newsletterOptions.window }, weeks);
    const filteredWeeks = filterWeeks(weeks, { ...params, since: bounds.since, until: bounds.until });
    const newsletter = buildNewsletter(filteredWeeks, deckContentIndex, bounds, newsletterOptions);
    if (route === 'newsletter.md' || safeLower(params.format) === 'markdown' || safeLower(params.output) === 'markdown') {
      return okText(renderNewsletterMarkdown(newsletter), freshness, 'text/markdown; charset=utf-8');
    }
    return ok(newsletter, freshness);
  }
  if (route === 'static-summary') return ok(summary, freshness);
  return notFound(route, freshness);
};
