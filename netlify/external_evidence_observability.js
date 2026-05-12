#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function asArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  for (const key of ['links', 'evidence', 'items', 'records', 'results', 'statuses', 'sources']) {
    if (Array.isArray(raw[key])) return raw[key];
  }
  return [];
}

function countHelio(links) {
  return links.filter(link => {
    const text = normalize(JSON.stringify(link)).toLowerCase();
    return text.includes('helio') || text.includes('glare-playground');
  }).length;
}

function countSheets(links) {
  return links.filter(link => {
    const text = normalize(JSON.stringify(link)).toLowerCase();
    return text.includes('docs.google.com/spreadsheets') || text.includes('google_sheet') || text.includes('spreadsheet');
  }).length;
}

function flattenObjects(obj, out = []) {
  if (obj == null) return out;
  if (Array.isArray(obj)) {
    for (const item of obj) flattenObjects(item, out);
    return out;
  }
  if (typeof obj === 'object') {
    out.push(obj);
    for (const value of Object.values(obj)) flattenObjects(value, out);
  }
  return out;
}

function fetchCounts(fetchStatus) {
  const flat = flattenObjects(fetchStatus || {});
  let success = 0;
  let failure = 0;
  for (const item of flat) {
    const status = normalize(item.status || item.result || item.fetch_status || '').toLowerCase();
    const ok = item.ok === true || item.success === true || status === 'ok' || status === 'success' || status === 'fetched';
    const failed = item.ok === false || item.success === false || /fail|error|denied|forbidden|unauth|missing/.test(status);
    const looksSheet = normalize(JSON.stringify(item)).toLowerCase().includes('sheet') || normalize(JSON.stringify(item)).toLowerCase().includes('spreadsheet');
    if (!looksSheet) continue;
    if (ok) success += 1;
    if (failed) failure += 1;
  }
  const summary = fetchStatus && fetchStatus.summary ? fetchStatus.summary : {};
  return {
    external_sheet_success_count: Number(summary.sheet_success_count || summary.google_sheet_success_count || summary.success_count || success || 0),
    external_sheet_failure_count: Number(summary.sheet_failure_count || summary.google_sheet_failure_count || summary.failure_count || failure || 0),
  };
}

function packExternalCount(raw) {
  const packs = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.packs) ? raw.packs : []);
  return packs.filter(pack => (pack.external_evidence_count || 0) > 0 || (pack.external_evidence_refs || []).length > 0).length;
}

function updateStatusFile(filePath, externalStatus, discoveryUpdates) {
  const status = readJson(filePath, null);
  if (!status) return false;
  const next = {
    ...status,
    external_evidence: externalStatus,
    discovery: {
      ...(status.discovery || {}),
      ...discoveryUpdates,
    },
  };
  writeJson(filePath, next);
  return true;
}

function makeLinkLine(href) {
  const label = '/' + href.replace(/^\//, '');
  const rel = href.replace(/^\//, '');
  return `  <li><a href="${rel}">${label}</a></li>`;
}

function injectArtifactLinks(filePath, hrefs) {
  if (!fs.existsSync(filePath)) return false;
  let html = fs.readFileSync(filePath, 'utf8');
  const missing = hrefs.filter(href => !html.includes(href.replace(/^\//, '')) && !html.includes(href));
  if (!missing.length) return false;
  const block = missing.map(makeLinkLine).join('\n') + '\n';
  if (html.includes('## Discovery and freshness')) {
    html = html.replace('## Discovery and freshness', block + '## Discovery and freshness');
  } else if (html.includes('## Discovery')) {
    html = html.replace('## Discovery', block + '## Discovery');
  } else {
    html += '\n' + block;
  }
  fs.writeFileSync(filePath, html, 'utf8');
  return true;
}

function main() {
  const publishRoot = process.argv[2] || 'publish';
  const dataDir = path.join(publishRoot, 'data');
  const deckLinks = readJson(path.join(dataDir, 'deck_links.json'), readJson(path.join(dataDir, 'deck-links.json'), null));
  const fetchStatus = readJson(path.join(dataDir, 'deck_link_fetch_status.json'), readJson(path.join(dataDir, 'deck-link-fetch-status.json'), null));
  const externalEvidence = readJson(path.join(dataDir, 'external_research_evidence.json'), readJson(path.join(dataDir, 'external-research-evidence.json'), null));
  const matchReport = readJson(path.join(dataDir, 'external_research_evidence_match_report.json'), readJson(path.join(dataDir, 'external-research-evidence-match-report.json'), null));
  const defaultPacks = readJson(path.join(dataDir, 'evidence_packs_default_30d.json'), readJson(path.join(dataDir, 'evidence-packs-default-30d.json'), null));

  const linksArray = asArray(deckLinks);
  const evidenceArray = asArray(externalEvidence);
  const fetch = fetchCounts(fetchStatus);
  const externalStatus = {
    generated_at: new Date().toISOString(),
    deck_link_count: Number(deckLinks?.summary?.link_count || deckLinks?.summary?.total_links || linksArray.length || 0),
    google_sheet_link_count: Number(deckLinks?.summary?.google_sheet_link_count || countSheets(linksArray)),
    helio_link_count: Number(deckLinks?.summary?.helio_link_count || countHelio(linksArray)),
    external_evidence_count: Number(externalEvidence?.evidence_count || externalEvidence?.summary?.evidence_count || evidenceArray.length || 0),
    external_sheet_success_count: fetch.external_sheet_success_count,
    external_sheet_failure_count: fetch.external_sheet_failure_count,
    matched_external_evidence_count: Number(matchReport?.matched_external_evidence_count || 0),
    unmatched_external_evidence_count: Number(matchReport?.unmatched_external_evidence_count || 0),
    evidence_pack_external_match_count: packExternalCount(defaultPacks),
    artifacts: {
      deck_links: 'data/deck_links.json',
      deck_link_fetch_status: 'data/deck_link_fetch_status.json',
      external_research_evidence: 'data/external_research_evidence.json',
      external_research_evidence_summary: 'data/external_research_evidence_summary.json',
      external_research_evidence_match_report: 'data/external_research_evidence_match_report.json',
    },
  };

  const discoveryUpdates = {
    deck_links: 'data/deck_links.json',
    deck_link_fetch_status: 'data/deck_link_fetch_status.json',
    external_research_evidence: 'data/external_research_evidence.json',
    external_research_evidence_summary: 'data/external_research_evidence_summary.json',
    external_research_evidence_match_report: 'data/external_research_evidence_match_report.json',
  };

  const hrefs = [
    'data/deck_links.json',
    'data/deck_link_fetch_status.json',
    'data/external_research_evidence.json',
    'data/external_research_evidence_summary.json',
    'data/external_research_evidence_match_report.json',
  ].filter(href => fs.existsSync(path.join(publishRoot, href)));

  const outputs = {
    status: updateStatusFile(path.join(publishRoot, 'status.json'), externalStatus, discoveryUpdates),
    api_status: updateStatusFile(path.join(publishRoot, 'api', 'status.json'), externalStatus, discoveryUpdates),
    homepage: injectArtifactLinks(path.join(publishRoot, 'index.html'), hrefs),
    api_index: injectArtifactLinks(path.join(publishRoot, 'api', 'index.html'), hrefs),
    newsletter_index: injectArtifactLinks(path.join(publishRoot, 'newsletter', 'index.html'), hrefs),
  };

  const summaryPath = path.join(dataDir, 'external_evidence_observability.json');
  writeJson(summaryPath, { generated_at: new Date().toISOString(), external_evidence: externalStatus, outputs });
  console.log(JSON.stringify({ external_evidence: externalStatus, outputs, summary: summaryPath }, null, 2));
}

main();
