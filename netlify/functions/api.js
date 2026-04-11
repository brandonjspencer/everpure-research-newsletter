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

function buildEditorialRecommendations(recurringThemes, inProgress, deckBackedInsights, audience) {
  const recommendations = [];
  if (recurringThemes.length) recommendations.push(`Lead with ${recurringThemes.slice(0, 2).map((row) => row.theme).join(' and ')} since those signals repeat across multiple weeks.`);
  if (inProgress.length) recommendations.push(`Reserve a short section for ${inProgress.slice(0, 2).map((row) => row.workstream).join(' and ')} so ongoing work is visible between issues.`);
  if (deckBackedInsights.length) recommendations.push('Use deck-backed evidence to support at least one major highlight so the issue feels grounded rather than anecdotal.');
  if (audience === 'exec') recommendations.push('Keep the lead summary short and decision-oriented, with explicit mention of repeated patterns and active workstreams.');
  if (audience === 'marketing') recommendations.push('Emphasize implications for messaging, page strategy, and content prioritization rather than raw research process detail.');
  if (audience === 'ux') recommendations.push('Preserve the testing context and iteration history so the issue is useful to research and design partners.');
  if (audience === 'product') recommendations.push('Translate repeated signals into possible decision, taxonomy, or flow implications for product stakeholders.');
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

function buildAudienceSummary(audience, tone, windowedWeeks, pack, deckContentIndex, recurringThemes, inProgress) {
  const base = buildExecutiveSummary(windowedWeeks, pack, deckContentIndex);
  const themeLead = recurringThemes[0] ? recurringThemes[0].theme : null;
  const progressLead = inProgress[0] ? inProgress[0].workstream : null;
  if (tone === 'brief') return truncate(base, 220);
  if (audience === 'exec') return `${base} ${themeLead ? `The clearest cross-week signal is ${themeLead}.` : ''} ${progressLead ? `${progressLead} remains active and should stay visible.` : ''}`.trim();
  if (audience === 'product') return `${base} ${themeLead ? `${themeLead} stands out as the strongest repeated signal for product-facing follow-up.` : ''}`.trim();
  if (audience === 'ux') return `${base} ${themeLead ? `${themeLead} appears repeatedly enough to merit explicit synthesis in the next issue.` : ''}`.trim();
  return `${base} ${themeLead ? `${themeLead} is the most reusable story thread for a stakeholder-facing newsletter.` : ''}`.trim();
}

function buildNewsletter(windowedWeeks, deckContentIndex, bounds, options = {}) {
  const audience = normalizeAudience(options.audience);
  const tone = normalizeTone(options.tone);
  const pack = buildPack(windowedWeeks, deckContentIndex, bounds.since, bounds.until);
  const deckBackedInsights = buildDeckBackedInsights(windowedWeeks, deckContentIndex, tone === 'brief' ? 3 : 6);
  const topFindings = buildTopFindings(windowedWeeks, tone === 'brief' ? 4 : 6);
  const recurringThemes = buildRecurringThemes(windowedWeeks, audience, tone === 'brief' ? 4 : 6);
  const inProgress = buildInProgress(windowedWeeks, audience, tone === 'brief' ? 4 : 6);
  const recommendedHighlights = buildRecommendedHighlights(windowedWeeks, audience, tone === 'brief' ? 4 : 6);
  const recommendations = buildEditorialRecommendations(recurringThemes, inProgress, deckBackedInsights, audience);
  const sectionTitles = audienceSectionTitles(audience);

  const newsletter = {
    generated_at: new Date().toISOString(),
    title: buildAudienceHeadline(audience, bounds),
    audience,
    tone,
    window: { since: bounds.since, until: bounds.until, label: bounds.window_label, days: bounds.days },
    overview: pack.overview,
    executive_summary: buildAudienceSummary(audience, tone, windowedWeeks, pack, deckContentIndex, recurringThemes, inProgress),
    section_counts: pack.group_counts,
    section_titles: sectionTitles,
    sections: {
      top_findings: topFindings,
      recurring_themes: recurringThemes,
      in_progress: inProgress,
      recommended_highlights: recommendedHighlights,
      deck_backed_insights: deckBackedInsights
    },
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
  lines.push(`_Audience: ${newsletter.audience} | Tone: ${newsletter.tone}_`);
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
  lines.push(`## ${newsletter.section_titles.top_findings}`);
  if ((newsletter.sections.top_findings || []).length) {
    for (const row of newsletter.sections.top_findings) {
      const refs = (row.source_refs || []).map((r) => r.week_date).filter(Boolean).join(', ');
      lines.push(`- **${row.headline}** — ${row.summary}${refs ? ` Source weeks: ${refs}.` : ''}`);
    }
  } else {
    lines.push('- No top findings identified in this window.');
  }
  lines.push('');
  lines.push(`## ${newsletter.section_titles.recurring_themes}`);
  if ((newsletter.sections.recurring_themes || []).length) {
    for (const row of newsletter.sections.recurring_themes) {
      const refs = (row.source_refs || []).map((r) => r.week_date).filter(Boolean).join(', ');
      lines.push(`- **${row.theme}** — ${row.implication}${refs ? ` Source weeks: ${refs}.` : ''}`);
    }
  } else {
    lines.push('- No recurring themes identified in this window.');
  }
  lines.push('');
  lines.push(`## ${newsletter.section_titles.in_progress}`);
  if ((newsletter.sections.in_progress || []).length) {
    for (const row of newsletter.sections.in_progress) {
      const refs = (row.source_refs || []).map((r) => r.week_date).filter(Boolean).join(', ');
      lines.push(`- **${row.workstream}** — ${row.note}${refs ? ` Source weeks: ${refs}.` : ''}`);
    }
  } else {
    lines.push('- No in-progress items surfaced.');
  }
  lines.push('');
  lines.push(`## ${newsletter.section_titles.recommended_highlights}`);
  if ((newsletter.sections.recommended_highlights || []).length) {
    for (const row of newsletter.sections.recommended_highlights) {
      const refs = (row.source_refs || []).map((r) => r.week_date).filter(Boolean).join(', ');
      lines.push(`- **${row.title}** — ${row.angle} Support: ${row.support}.${refs ? ` Source weeks: ${refs}.` : ''}`);
    }
  } else {
    lines.push('- No recommended highlights available.');
  }
  lines.push('');
  lines.push('## Deck-backed evidence');
  if ((newsletter.sections.deck_backed_insights || []).length) {
    for (const row of newsletter.sections.deck_backed_insights) {
      lines.push(`- ${row.week_date} / ${row.file_id}: ${row.excerpt || 'Deck text available.'}`);
    }
  } else {
    lines.push('- No ingested deck text available for this window.');
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
    const newsletter = buildNewsletter(filteredWeeks, deckContentIndex, bounds, { audience: params.audience, tone: params.tone });
    if (route === 'newsletter.md' || safeLower(params.format) === 'markdown' || safeLower(params.output) === 'markdown') {
      return okText(renderNewsletterMarkdown(newsletter), freshness, 'text/markdown; charset=utf-8');
    }
    return ok(newsletter, freshness);
  }
  if (route === 'static-summary') return ok(summary, freshness);
  return notFound(route, freshness);
};
