#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
function write(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
}

function dedupeActionBulletsInHtml(html) {
  const heading = '## What we should do next';
  const idx = html.indexOf(heading);
  if (idx === -1) return html;
  const start = html.indexOf('\n', idx);
  let end = html.length;
  const nextH2 = html.indexOf('\n## ', start + 1);
  if (nextH2 !== -1) end = nextH2;
  const section = html.slice(start + 1, end);
  const lines = section.split('\n');
  const seen = new Set();
  const kept = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- **')) {
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(line);
  }
  return html.slice(0, start + 1) + kept.join('\n') + html.slice(end);
}

function mergeKnowledgePortalInHtml(html) {
  const startMarker = '## What is still in motion';
  const idx = html.indexOf(startMarker);
  if (idx === -1) return html;
  const start = html.indexOf('\n', idx);
  let end = html.length;
  const nextH2 = html.indexOf('\n## ', start + 1);
  if (nextH2 !== -1) end = nextH2;
  let section = html.slice(start + 1, end);

  const kpPattern = /### Knowledge Portal Landing Page[\s\S]*?- \*\*Decision \/ confidence:\*\*[^\n]*\n### Knowledge Portal Homepage[\s\S]*?- \*\*Decision \/ confidence:\*\*[^\n]*/m;
  if (!kpPattern.test(section)) return html;

  const replacement = [
    '### Knowledge Portal structure',
    '- **What we are seeing:** Knowledge portal and platform work is converging on naming and structure, which makes discoverability the main problem to solve next.',
    '- **Evidence snapshot:** Captured in the 2026-03-26 weekly update; Supported by 1 linked findings deck',
    '- **Supporting signals:** Captured in the 2026-03-26 weekly update | Supported by 1 linked findings deck',
    '- **What we should do next:** Simplify structure and naming, then validate whether people understand the destination and can find the right entry point faster.',
    '- **Decision / confidence:** Watch / Directional signal only'
  ].join('\n');

  section = section.replace(kpPattern, replacement);
  return html.slice(0, start + 1) + section + html.slice(end);
}

function dedupeActionBulletsInMd(md) {
  return dedupeActionBulletsInHtml(md);
}
function mergeKnowledgePortalInMd(md) {
  return mergeKnowledgePortalInHtml(md);
}

function normalizeJson(jsonText) {
  let data;
  try { data = JSON.parse(jsonText); } catch { return jsonText; }
  if (!data || typeof data !== 'object') return jsonText;

  const next = data.next_actions || data.nextActions || data.what_we_should_do_next;
  if (Array.isArray(next)) {
    const seen = new Set();
    const deduped = [];
    for (const item of next) {
      const label = typeof item === 'string'
        ? item
        : (item.title || item.label || item.concept || item.name || JSON.stringify(item));
      const key = String(label).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }
    if (data.next_actions) data.next_actions = deduped;
    if (data.nextActions) data.nextActions = deduped;
    if (data.what_we_should_do_next) data.what_we_should_do_next = deduped;
  }

  const buckets = ['work_in_motion', 'workInMotion', 'what_is_still_in_motion'];
  for (const bucket of buckets) {
    if (!Array.isArray(data[bucket])) continue;
    const arr = data[bucket];
    const out = [];
    let merged = false;
    for (const item of arr) {
      const title = String(item?.title || item?.concept || item?.name || '').toLowerCase();
      if (title.includes('knowledge portal landing page') || title.includes('knowledge portal homepage')) {
        if (!merged) {
          out.push({
            title: 'Knowledge Portal structure',
            finding_statement: 'Knowledge portal and platform work is converging on naming and structure, which makes discoverability the main problem to solve next.',
            evidence_snapshot: 'Captured in the 2026-03-26 weekly update; Supported by 1 linked findings deck',
            supporting_signals: ['Captured in the 2026-03-26 weekly update', 'Supported by 1 linked findings deck'],
            next_step: 'Simplify structure and naming, then validate whether people understand the destination and can find the right entry point faster.',
            decision_status: 'Watch',
            confidence_level: 'Directional signal only'
          });
          merged = true;
        }
      } else {
        out.push(item);
      }
    }
    data[bucket] = out;
  }

  delete data.editorial_recommendations;
  delete data.editorialRecommendations;

  return JSON.stringify(data, null, 2) + '\n';
}

const root = process.argv[2] || 'publish';
const files = {
  html: path.join(root, 'newsletter', 'default.html'),
  md: path.join(root, 'newsletter', 'default.md'),
  json: path.join(root, 'newsletter', 'default.json')
};

const html = readIfExists(files.html);
if (html) write(files.html, dedupeActionBulletsInHtml(mergeKnowledgePortalInHtml(html)));
const md = readIfExists(files.md);
if (md) write(files.md, dedupeActionBulletsInMd(mergeKnowledgePortalInMd(md)));
const json = readIfExists(files.json);
if (json) write(files.json, normalizeJson(json));

console.log(JSON.stringify({
  updated: Object.values(files).filter(p => fs.existsSync(p)),
  root
}, null, 2));
