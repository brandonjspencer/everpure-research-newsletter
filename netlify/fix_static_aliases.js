#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) {
    return { ok: false, reason: `missing:${src}` };
  }
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return { ok: true };
}

function updateHomepageLinks(homepagePath) {
  if (!fs.existsSync(homepagePath)) return false;
  let html = fs.readFileSync(homepagePath, 'utf8');
  html = html.replace(/data\/deck_content\.json/g, 'data/deck-content.json');
  fs.writeFileSync(homepagePath, html, 'utf8');
  return true;
}

const root = process.argv[2] || process.env.PUBLISH_DIR || 'publish';
const dataDir = path.join(root, 'data');
const mappings = [
  ['deck_content.json', 'deck-content.json'],
  ['refresh_manifest.json', 'refresh-manifest.json'],
  ['deck_week_map.json', 'deck-week-map.json'],
  ['deck_summary.json', 'deck-summary.json'],
  ['deck_details.json', 'deck-details.json'],
  ['newsletter_pack_90d.json', 'newsletter-pack-90d.json'],
];

const results = [];
for (const [srcName, destName] of mappings) {
  const result = copyIfExists(path.join(dataDir, srcName), path.join(dataDir, destName));
  results.push({ src: srcName, dest: destName, ...result });
}

const homepageUpdated = updateHomepageLinks(path.join(root, 'index.html'));
const newsletterIndexUpdated = updateHomepageLinks(path.join(root, 'newsletter', 'index.html'));
const apiIndexUpdated = updateHomepageLinks(path.join(root, 'api', 'index.html'));

const summary = {
  publish_root: root,
  results,
  homepageUpdated,
  newsletterIndexUpdated,
  apiIndexUpdated,
};

console.log(JSON.stringify(summary, null, 2));
