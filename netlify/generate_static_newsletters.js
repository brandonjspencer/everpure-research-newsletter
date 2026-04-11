const fs = require('fs');
const path = require('path');
const { handler } = require('./functions/api.js');

const ROOT = path.join(__dirname, '..');
const PUBLISH_DIR = path.join(ROOT, 'publish');
const NEWSLETTER_DIR = path.join(PUBLISH_DIR, 'newsletter');
const API_DIR = path.join(PUBLISH_DIR, 'api');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function esc(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function callRoute(route, query = {}) {
  const queryStringParameters = Object.fromEntries(
    Object.entries(query).map(([k, v]) => [k, String(v)])
  );
  const event = {
    path: `/api/${route}`,
    rawPath: `/api/${route}`,
    rawUrl: `https://example.com/api/${route}`,
    headers: {
      host: 'example.com',
      'x-forwarded-proto': 'https'
    },
    queryStringParameters
  };
  const context = { params: { splat: route } };
  return handler(event, context);
}

function markdownToHtml(title, markdown) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; color: #111; max-width: 960px; }
    .meta { color: #666; margin-bottom: 24px; }
    pre { white-space: pre-wrap; word-wrap: break-word; background: #fafafa; padding: 24px; border-radius: 8px; border: 1px solid #e5e5e5; }
    a { color: #0a66c2; text-decoration: none; }
  </style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <div class="meta">Static artifact generated during build for GitHub Pages and Netlify compatibility.</div>
  <p><a href="../index.html">Back to homepage</a></p>
  <pre>${esc(markdown)}</pre>
</body>
</html>`;
}

function buildList(items) {
  return items.map((item) => `<li><a href="${item.href}">${item.label}</a></li>`).join('\n');
}

function buildNewsIndex(status, links) {
  const generatedAt = ((status || {})._meta || {}).generated_at || '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Everpure Newsletter Outputs</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; color: #111; max-width: 960px; }
    a { color: #0a66c2; text-decoration: none; }
  </style>
</head>
<body>
  <h1>Everpure Newsletter Outputs</h1>
  <p>Static outputs generated during build for reliable discovery and review.</p>
  <p><strong>Generated:</strong> ${esc(generatedAt)}</p>
  <h2>Default monthly brief</h2>
  <ul>${buildList([
    { href: links.defaultJson, label: links.defaultJson },
    { href: links.defaultMd, label: links.defaultMd },
    { href: links.defaultHtml, label: links.defaultHtml }
  ])}</ul>
  <h2>Marketing activity log (30d)</h2>
  <ul>${buildList([
    { href: links.marketingJson, label: links.marketingJson },
    { href: links.marketingMd, label: links.marketingMd },
    { href: links.marketingHtml, label: links.marketingHtml }
  ])}</ul>
  <h2>Discovery</h2>
  <ul>${buildList([
    { href: '../status.json', label: '../status.json' },
    { href: '../api/status.json', label: '../api/status.json' },
    { href: '../api/index.html', label: '../api/index.html' }
  ])}</ul>
  <p><a href="../index.html">Back to homepage</a></p>
</body>
</html>`;
}

function buildApiIndex() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Everpure Static API Mirror</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; color: #111; max-width: 960px; }
    a { color: #0a66c2; text-decoration: none; }
  </style>
</head>
<body>
  <h1>Everpure Static API Mirror</h1>
  <p>GitHub Pages-friendly static equivalents of the most useful API outputs.</p>
  <ul>${buildList([
    { href: 'status.json', label: 'status.json' },
    { href: 'newsletter-default.json', label: 'newsletter-default.json' },
    { href: 'newsletter-default.md', label: 'newsletter-default.md' },
    { href: 'newsletter-marketing-activity-30d.json', label: 'newsletter-marketing-activity-30d.json' },
    { href: 'newsletter-marketing-activity-30d.md', label: 'newsletter-marketing-activity-30d.md' },
    { href: '../data/weeks.json', label: '../data/weeks.json' },
    { href: '../data/deck-content.json', label: '../data/deck-content.json' }
  ])}</ul>
  <p><a href="../index.html">Back to homepage</a></p>
</body>
</html>`;
}

function buildHomeHtml(status) {
  const generatedAt = ((status || {})._meta || {}).generated_at || '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Everpure Research Newsletter Builder</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; color: #111; max-width: 960px; }
    a { color: #0a66c2; text-decoration: none; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Everpure Research Newsletter Builder</h1>
  <p>This site publishes static newsletter and data artifacts generated from the live Everpure Notion page and linked Google findings decks.</p>
  <p><strong>Generated:</strong> ${esc(generatedAt)}</p>
  <h2>Default monthly issue</h2>
  <ul>${buildList([
    { href: 'newsletter/default.html', label: 'newsletter/default.html' },
    { href: 'newsletter/default.md', label: 'newsletter/default.md' },
    { href: 'newsletter/default.json', label: 'newsletter/default.json' }
  ])}</ul>
  <h2>Marketing activity log</h2>
  <ul>${buildList([
    { href: 'newsletter/marketing-activity-30d.html', label: 'newsletter/marketing-activity-30d.html' },
    { href: 'newsletter/marketing-activity-30d.md', label: 'newsletter/marketing-activity-30d.md' },
    { href: 'newsletter/marketing-activity-30d.json', label: 'newsletter/marketing-activity-30d.json' }
  ])}</ul>
  <h2>Discovery and freshness</h2>
  <ul>${buildList([
    { href: 'status.json', label: 'status.json' },
    { href: 'api/index.html', label: 'api/index.html' },
    { href: 'newsletter/index.html', label: 'newsletter/index.html' }
  ])}</ul>
  <h2>Static data outputs</h2>
  <ul>${buildList([
    { href: 'data/weeks.json', label: 'data/weeks.json' },
    { href: 'data/summary.json', label: 'data/summary.json' },
    { href: 'data/deck-content.json', label: 'data/deck-content.json' },
    { href: 'data/refresh_manifest.json', label: 'data/refresh_manifest.json' }
  ])}</ul>
</body>
</html>`;
}

(async () => {
  ensureDir(NEWSLETTER_DIR);
  ensureDir(API_DIR);

  const statusRes = await callRoute('status');
  const defaultJsonRes = await callRoute('newsletter-default');
  const defaultMdRes = await callRoute('newsletter-default.md');
  const marketingJsonRes = await callRoute('newsletter-marketing-activity-30d');
  const marketingMdRes = await callRoute('newsletter-marketing-activity-30d.md');

  const statusJson = JSON.parse(statusRes.body);
  const defaultJson = JSON.parse(defaultJsonRes.body);
  const marketingJson = JSON.parse(marketingJsonRes.body);
  const defaultMd = defaultMdRes.body;
  const marketingMd = marketingMdRes.body;

  const discovery = {
    homepage: 'index.html',
    status_json: 'status.json',
    api_status_json: 'api/status.json',
    newsletter_index: 'newsletter/index.html',
    api_index: 'api/index.html',
    default_json: 'newsletter/default.json',
    default_md: 'newsletter/default.md',
    default_html: 'newsletter/default.html',
    marketing_json: 'newsletter/marketing-activity-30d.json',
    marketing_md: 'newsletter/marketing-activity-30d.md',
    marketing_html: 'newsletter/marketing-activity-30d.html'
  };

  const statusOut = {
    ...statusJson,
    discovery
  };

  fs.writeFileSync(path.join(NEWSLETTER_DIR, 'default.json'), JSON.stringify(defaultJson, null, 2));
  fs.writeFileSync(path.join(NEWSLETTER_DIR, 'default.md'), defaultMd);
  fs.writeFileSync(path.join(NEWSLETTER_DIR, 'default.html'), markdownToHtml(defaultJson.title || 'Default monthly brief', defaultMd));

  fs.writeFileSync(path.join(NEWSLETTER_DIR, 'marketing-activity-30d.json'), JSON.stringify(marketingJson, null, 2));
  fs.writeFileSync(path.join(NEWSLETTER_DIR, 'marketing-activity-30d.md'), marketingMd);
  fs.writeFileSync(path.join(NEWSLETTER_DIR, 'marketing-activity-30d.html'), markdownToHtml(marketingJson.title || 'Marketing activity log', marketingMd));

  fs.writeFileSync(path.join(NEWSLETTER_DIR, 'index.html'), buildNewsIndex(statusJson, {
    defaultJson: 'default.json',
    defaultMd: 'default.md',
    defaultHtml: 'default.html',
    marketingJson: 'marketing-activity-30d.json',
    marketingMd: 'marketing-activity-30d.md',
    marketingHtml: 'marketing-activity-30d.html'
  }));

  fs.writeFileSync(path.join(PUBLISH_DIR, 'index.html'), buildHomeHtml(statusOut));
  fs.writeFileSync(path.join(PUBLISH_DIR, 'status.json'), JSON.stringify(statusOut, null, 2));

  fs.writeFileSync(path.join(API_DIR, 'status.json'), JSON.stringify(statusOut, null, 2));
  fs.writeFileSync(path.join(API_DIR, 'newsletter-default.json'), JSON.stringify(defaultJson, null, 2));
  fs.writeFileSync(path.join(API_DIR, 'newsletter-default.md'), defaultMd);
  fs.writeFileSync(path.join(API_DIR, 'newsletter-marketing-activity-30d.json'), JSON.stringify(marketingJson, null, 2));
  fs.writeFileSync(path.join(API_DIR, 'newsletter-marketing-activity-30d.md'), marketingMd);
  fs.writeFileSync(path.join(API_DIR, 'index.html'), buildApiIndex());
})();
