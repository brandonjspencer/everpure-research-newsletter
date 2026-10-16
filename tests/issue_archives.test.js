"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  enhanceArchivedHtml,
  enhanceArchivedMarkdown,
  enhanceArchivedIssues,
} = require("../netlify/publish_issue_archives");

// A frozen issue from before the hero mesh: same masthead markup the renderer still writes.
const LEGACY = `<!doctype html><html><head><title>Issue 01</title><style>.masthead { background: #2D2A27; }</style></head>
<body><header class="masthead"><div class="wrapper"><a class="back-link" href="../">See all Issues</a><div class="ghost">01</div></div></header></body></html>`;

// A frozen issue that already carries the mesh, video, and motion layer (October onward).
const CURRENT = `<!doctype html><html><head><script defer src="../vendor/motion-11.18.2.min.js"></script>
<script defer src="../vendor/hex-mesh-hero.min.js"></script></head>
<body><header class="masthead"><div class="hero-mesh" aria-hidden="true"></div><div class="wrapper"><a class="back-link" href="../">See all Issues</a></div></header>
<video poster="../media/r.jpg"><source src="../media/r.mp4"></video></body></html>`;

test("adds the hero mesh to a legacy masthead, reaching the vendor bundle from two levels deep", () => {
  const out = enhanceArchivedHtml(LEGACY, { mesh: true });
  assert.match(out, /<header class="masthead">\n<div class="hero-mesh" aria-hidden="true"><\/div>/);
  assert.match(out, /<script defer src="\.\.\/\.\.\/vendor\/hex-mesh-hero\.min\.js"><\/script>/);
  assert.match(out, /EverpureHexMesh\.mount\(h,\{color:\[1,0\.961,0\.89\],opacity:0\.04,scale:2/);
  assert.match(out, /\.masthead \{ position:relative; overflow:hidden; \}/);
  assert.ok(out.indexOf("hex-mesh-hero") < out.indexOf("</head>"), "mesh script sits in <head>");
  // the back link already points at the archive index from /issues/YYYY-MM/ — leave it alone
  assert.match(out, /class="back-link" href="\.\.\/"/);
});

test("re-points one-level asset paths without duplicating an existing mesh", () => {
  const out = enhanceArchivedHtml(CURRENT, { mesh: true });
  assert.equal(out.split('class="hero-mesh"').length - 1, 1);
  assert.match(out, /src="\.\.\/\.\.\/vendor\/motion-11\.18\.2\.min\.js"/);
  assert.match(out, /src="\.\.\/\.\.\/vendor\/hex-mesh-hero\.min\.js"/);
  assert.match(out, /poster="\.\.\/\.\.\/media\/r\.jpg"/);
  assert.match(out, /<source src="\.\.\/\.\.\/media\/r\.mp4">/);
  assert.match(out, /class="back-link" href="\.\.\/"/);
});

test("is idempotent", () => {
  for (const html of [LEGACY, CURRENT]) {
    const once = enhanceArchivedHtml(html, { mesh: true });
    assert.equal(enhanceArchivedHtml(once, { mesh: true }), once);
  }
  const md = "[▶ Watch](../media/r.mp4)";
  const fixed = enhanceArchivedMarkdown(md);
  assert.equal(fixed, "[▶ Watch](../../media/r.mp4)");
  assert.equal(enhanceArchivedMarkdown(fixed), fixed);
});

test("rewrites only the published copies, adding the mesh to default.html alone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archives-"));
  const month = path.join(dir, "2026-04");
  fs.mkdirSync(month);
  fs.writeFileSync(path.join(month, "issue_manifest.json"), "{}");
  fs.writeFileSync(path.join(month, "default.html"), LEGACY);
  fs.writeFileSync(path.join(month, "marketing-activity-30d.html"), LEGACY);
  fs.writeFileSync(path.join(month, "default.md"), "no video");
  const changed = enhanceArchivedIssues(dir);
  assert.deepStrictEqual(changed, ["issues/2026-04/default.html"]);
  assert.match(fs.readFileSync(path.join(month, "default.html"), "utf8"), /hero-mesh/);
  assert.doesNotMatch(
    fs.readFileSync(path.join(month, "marketing-activity-30d.html"), "utf8"),
    /hero-mesh/
  );
  assert.deepStrictEqual(enhanceArchivedIssues(dir), [], "second pass changes nothing");
});
