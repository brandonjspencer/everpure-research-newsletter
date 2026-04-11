const fs = require('fs');
const path = require('path');
const { handler } = require('./functions/api.js');

const ROOT = path.join(__dirname, '..');
const PUBLISH_DIR = path.join(ROOT, 'publish');
const NEWSLETTER_DIR = path.join(PUBLISH_DIR, 'newsletter');

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
    rawUrl: `https://example.netlify.app/api/${route}`,
    headers: {
      host: 'example.netlify.app',
      'x-forwarded-proto': 'https'
    },
    queryStringParameters
  };
  const context = { params: { splat: route } };
  const response = await handler(event, context);
  return response;
}

function markdownToHtml(title, markdown) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; color: #111; }
    .meta { color: #666; margin-bottom: 24px; }
    pre { white-space: pre-wrap; word-wrap: break-word; background: #fafafa; padding: 24px; border-radius: 8px; border: 1px solid #e5e5e5; }
    a { color: #0a66c2; text-decoration: none; }
  </style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <div class="meta">Static artifact generated during Netlify build for reliable discovery and review.</div>
  <pre>${esc(markdown)}</pre>
</body>
</html>`;
}

function buildIndexHtml(status, files) {
  const generatedAt = ((status || {})._meta || {}).generated_at || '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Everpure Newsletter Outputs</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; color: #111; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; }
    ul { padding-left: 20px; }
    a { color: #0a66c2; text-decoration: none; }
  </style>
</head>
<body>
  <h1>Everpure Newsletter Outputs</h1>
  <p>These are the stable newsletter artifacts generated during the latest build.</p>
  <p><strong>Generated:</strong> ${esc(generatedAt)}</p>
  <h2>Default monthly brief</h2>
  <ul>
    <li><a href="${files.defaultJson}">${files.defaultJson}</a></li>
    <li><a href="${files.defaultMd}">${files.defaultMd}</a></li>
    <li><a href="${files.defaultHtml}">${files.defaultHtml}</a></li>
  </ul>
  <h2>Marketing activity log (30d)</h2>
  <ul>
    <li><a href="${files.marketingJson}">${files.marketingJson}</a></li>
    <li><a href="${files.marketingMd}">${files.marketingMd}</a></li>
    <li><a href="${files.marketingHtml}">${files.marketingHtml}</a></li>
  </ul>
  <h2>Live API shortcuts</h2>
  <ul>
    <li><a href="/api/status">/api/status</a></li>
    <li><a href="/api/newsletter-default">/api/newsletter-default</a></li>
    <li><a href="/api/newsletter-default.md">/api/newsletter-default.md</a></li>
    <li><a href="/api/newsletter-marketing-activity-30d">/api/newsletter-marketing-activity-30d</a></li>
    <li><a href="/api/newsletter-marketing-activity-30d.md">/api/newsletter-marketing-activity-30d.md</a></li>
  </ul>
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
  <title>Everpure Research API</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; color: #111; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; }
    ul { padding-left: 20px; }
    a { color: #0a66c2; text-decoration: none; }
  </style>
</head>
<body>
  <h1>Everpure Research API</h1>
  <p>This site serves normalized research outputs and stable newsletter artifacts generated from the Everpure Notion pipeline.</p>
  <p><strong>Generated:</strong> ${esc(generatedAt)}</p>
  <h2>Status and discovery</h2>
  <ul>
    <li><a href="/api/status">/api/status</a></li>
    <li><a href="/newsletter/">/newsletter/</a></li>
  </ul>
  <h2>Stable newsletter API routes</h2>
  <ul>
    <li><a href="/api/newsletter-default">/api/newsletter-default</a></li>
    <li><a href="/api/newsletter-default.md">/api/newsletter-default.md</a></li>
    <li><a href="/api/newsletter-marketing-activity-30d">/api/newsletter-marketing-activity-30d</a></li>
    <li><a href="/api/newsletter-marketing-activity-30d.md">/api/newsletter-marketing-activity-30d.md</a></li>
  </ul>
  <h2>Static newsletter artifacts</h2>
  <ul>
    <li><a href="/newsletter/default.json">/newsletter/default.json</a></li>
    <li><a href="/newsletter/default.md">/newsletter/default.md</a></li>
    <li><a href="/newsletter/default.html">/newsletter/default.html</a></li>
    <li><a href="/newsletter/marketing-activity-30d.json">/newsletter/marketing-activity-30d.json</a></li>
    <li><a href="/newsletter/marketing-activity-30d.md">/newsletter/marketing-activity-30d.md</a></li>
    <li><a href="/newsletter/marketing-activity-30d.html">/newsletter/marketing-activity-30d.html</a></li>
  </ul>
  <h2>Source data endpoints</h2>
  <ul>
    <li><a href="/api/health">/api/health</a></li>
    <li><a href="/api/metadata">/api/metadata</a></li>
    <li><a href="/api/weeks">/api/weeks</a></li>
    <li><a href="/api/findings">/api/findings</a></li>
    <li><a href="/api/summary">/api/summary</a></li>
    <li><a href="/api/decks">/api/decks</a></li>
    <li><a href="/api/deck-summary">/api/deck-summary</a></li>
    <li><a href="/api/deck-details">/api/deck-details</a></li>
    <li><a href="/api/deck-content">/api/deck-content</a></li>
  </ul>
</body>
</html>`;
}

(async () => {
  ensureDir(NEWSLETTER_DIR);

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

  const files = {
    defaultJson: '/newsletter/default.json',
    defaultMd: '/newsletter/default.md',
    defaultHtml: '/newsletter/default.html',
    marketingJson: '/newsletter/marketing-activity-30d.json',
    marketingMd: '/newsletter/marketing-activity-30d.md',
    marketingHtml: '/newsletter/marketing-activity-30d.html'
  };

  fs.writeFileSync(path.join(NEWSLETTER_DIR, 'default.json'), JSON.stringify(defaultJson, null, 2));
  fs.writeFileSync(path.join(NEWSLETTER_DIR, 'default.md'), defaultMd);
  fs.writeFileSync(path.join(NEWSLETTER_DIR, 'default.html'), markdownToHtml(defaultJson.title || 'Default monthly brief', defaultMd));
  fs.writeFileSync(path.join(NEWSLETTER_DIR, 'marketing-activity-30d.json'), JSON.stringify(marketingJson, null, 2));
  fs.writeFileSync(path.join(NEWSLETTER_DIR, 'marketing-activity-30d.md'), marketingMd);
  fs.writeFileSync(path.join(NEWSLETTER_DIR, 'marketing-activity-30d.html'), markdownToHtml(marketingJson.title || 'Marketing activity log', marketingMd));
  fs.writeFileSync(path.join(NEWSLETTER_DIR, 'index.html'), buildIndexHtml(statusJson, files));
  fs.writeFileSync(path.join(PUBLISH_DIR, 'index.html'), buildHomeHtml(statusJson));
})();
