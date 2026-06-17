"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const theme = require("../netlify/dashboard_theme");
const sitemap = require("../netlify/render_sitemap");

test("sidebar marks the active page and uses root-relative hrefs from the homepage", () => {
  const html = theme.sidebar("dashboard", "");
  assert.match(html, /class="navlink active"[^>]*aria-current="page"/);
  assert.match(html, /href="index\.html"/); // dashboard from root
  assert.match(html, /href="issues\/"/);
  assert.match(html, /href="activity\/"/);
  assert.match(html, /href="sitemap\/"/);
  assert.match(html, /id="themeToggle"/);
});

test("sidebar prefixes links for one-level pages", () => {
  const html = theme.sidebar("issues", "../");
  assert.match(html, /class="navlink active"[^>]*href="\.\.\/issues\/"/);
  assert.match(html, /href="\.\.\/"/); // dashboard from a sub-page
  assert.match(html, /href="\.\.\/sitemap\/"/);
});

test("docHead embeds the brand favicon as a depth-agnostic data URI", () => {
  // A data URI (no path) renders at any /<repo>/ subpath depth without a prefix.
  assert.match(
    theme.docHead("X"),
    /<link rel="icon" href="data:image\/x-icon;base64,[A-Za-z0-9+/=]{200,}">/
  );
  // The embedded payload round-trips to a real .ico (MS icon magic 00 00 01 00).
  const b64 = theme.FAVICON_LINK.match(/base64,([^"]+)/)[1];
  const bytes = Buffer.from(b64, "base64");
  assert.deepEqual([...bytes.subarray(0, 4)], [0, 0, 1, 0]);
});

test("brandCss defines both light and dark theme variables", () => {
  const css = theme.brandCss();
  assert.match(css, /--paper:#/);
  assert.match(css, /\[data-theme="dark"\]/);
  assert.match(css, /--c-high/); // chart colors are themed vars
});

test("themeInit persists choice and respects the OS preference", () => {
  const js = theme.themeInit();
  assert.match(js, /localStorage/);
  assert.match(js, /prefers-color-scheme/);
  assert.match(js, /data-theme/);
});

test("sitemap buckets pages correctly and stays comprehensive", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sitemap-"));
  const pub = path.join(root, "publish");
  const files = [
    "index.html",
    "sitemap/index.html",
    "issues/index.html",
    "issues/2026-06/default.html",
    "newsletter/default.html",
    "newsletter/marketing-activity-30d.html",
    "newsletter/index.html",
    "api/health.json",
    "data/trends.json",
    ".nojekyll",
  ];
  for (const f of files) {
    fs.mkdirSync(path.join(pub, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(pub, f), "x");
  }
  try {
    const html = sitemap.render(root);
    // Real issue lands under the issues section with a friendly label.
    assert.match(html, /Issue 2026-06 — research roundup/);
    // Section indexes are NOT mislabeled as issues — they go under "Other pages".
    assert.match(html, /Other pages/);
    // API + data are listed (comprehensive).
    assert.match(html, /api\/health\.json/);
    assert.match(html, /data\/trends\.json/);
    // The activity log is a primary page.
    assert.match(html, /Research activity log \(30d\)/);
    // Branded shell + sidebar present, sitemap active.
    assert.match(html, /class="rail"/);
    assert.match(html, /class="navlink active"[^>]*href="\.\.\/sitemap\/"/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("hrefFor collapses index.html to a clean directory URL", () => {
  assert.equal(sitemap.hrefFor("issues/index.html"), "../issues/");
  assert.equal(sitemap.hrefFor("newsletter/default.html"), "../newsletter/default.html");
});
