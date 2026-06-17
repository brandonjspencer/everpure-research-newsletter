#!/usr/bin/env node
/**
 * Render a branded, comprehensive sitemap from the BUILT publish/ tree.
 *
 * It walks publish/ at build time, so it lists every page + API/data artifact
 * that actually shipped — it can't drift from reality. Writes
 * publish/sitemap/index.html. Run LAST in the build (after all pages exist).
 *
 * Run: node netlify/render_sitemap.js <repo-root>
 */
const fs = require("fs");
const path = require("path");
const { docHead, sidebar } = require("./dashboard_theme");

function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );
}

function walk(dir, base, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, base, out);
    else out.push(path.relative(base, fp).split(path.sep).join("/"));
  }
  return out;
}

// Friendly labels for the known human-facing pages.
function labelFor(rel) {
  const known = {
    "index.html": "Dashboard — research trends (home)",
    "sitemap/index.html": "Sitemap",
    "issues/index.html": "Issues archive",
    "newsletter/default.html": "Current newsletter — default brief",
    "newsletter/marketing-activity-30d.html": "Research activity log (30d)",
  };
  if (known[rel]) return known[rel];
  let m = rel.match(/^issues\/(\d{4}-\d{2})\/default\.html$/);
  if (m) return `Issue ${m[1]} — research roundup`;
  m = rel.match(/^issues\/(\d{4}-\d{2})\/marketing-activity-30d\.html$/);
  if (m) return `Issue ${m[1]} — activity log`;
  return rel.replace(/\/index\.html$/, "/").replace(/\.html$/, "");
}

// Link to clean directory URLs where there's an index.html.
function hrefFor(rel) {
  return "../" + rel.replace(/(^|\/)index\.html$/, "$1");
}

function linkList(items, withLabel) {
  if (!items.length) return `<p class="empty">None.</p>`;
  return `<ul class="linklist">${items
    .map((rel) => {
      const href = hrefFor(rel);
      const left = withLabel ? esc(labelFor(rel)) : `<code>${esc("/" + rel)}</code>`;
      const right = withLabel ? `<span class="path">/${esc(rel)}</span>` : "";
      return `<li><a href="${href}">${left}</a>${right}</li>`;
    })
    .join("")}</ul>`;
}

function section(title, desc, items, withLabel) {
  if (!items.length) return "";
  return `<section class="panel">
  <h2>${title}</h2>
  <p class="desc">${desc}</p>
  ${linkList(items, withLabel)}
</section>`;
}

function render(root) {
  const publishDir = path.join(root, "publish");
  const all = walk(publishDir, publishDir, []).sort();

  const isHtml = (r) => r.endsWith(".html");
  const isDotfile = (r) => r.split("/").pop().startsWith(".");

  // Mutually-exclusive buckets, assigned by priority. `take` claims each path
  // once; the final `take(() => true)` is a catch-all so NOTHING is silently
  // dropped — every published endpoint lands in exactly one section.
  const order = [
    "index.html",
    "issues/index.html",
    "newsletter/default.html",
    "newsletter/marketing-activity-30d.html",
    "sitemap/index.html",
  ];
  const used = new Set();
  const primary = order.filter((p) => all.includes(p));
  primary.forEach((p) => used.add(p));
  const take = (pred) => {
    const out = all.filter((r) => !used.has(r) && !isDotfile(r) && pred(r));
    out.forEach((r) => used.add(r));
    return out;
  };

  const issuePages = take((r) => /^issues\/\d{4}-\d{2}\//.test(r) && isHtml(r));
  const issueArtifacts = take((r) => /^issues\/\d{4}-\d{2}\//.test(r));
  const apiFiles = take((r) => r.startsWith("api/") && !isHtml(r));
  const dataFiles = take((r) => r.startsWith("data/"));
  const historyFiles = take((r) => r.startsWith("history/"));
  const otherPages = take((r) => isHtml(r));
  const otherFiles = take(() => true); // catch-all: anything still unclaimed

  const totalListed =
    primary.length +
    issuePages.length +
    issueArtifacts.length +
    apiFiles.length +
    dataFiles.length +
    historyFiles.length +
    otherPages.length +
    otherFiles.length;

  const sections = [
    section("Pages", "The human-facing pages.", primary, true),
    section(
      "Published issues",
      "Frozen monthly issues — the email-CTA targets, immutable once approved.",
      issuePages,
      true
    ),
    section(
      "Issue data &amp; manifests",
      "Per-issue JSON / Markdown / manifest artifacts behind each frozen issue.",
      issueArtifacts,
      false
    ),
    section("Other pages", "Section indexes and additional generated pages.", otherPages, true),
    section(
      "API endpoints",
      "Static JSON / Markdown served under <code>/api/</code>.",
      apiFiles,
      false
    ),
    section(
      "Data artifacts",
      "Build outputs under <code>/data/</code> — the deterministic evidence substrate (both underscore and hyphenated aliases ship).",
      dataFiles,
      false
    ),
    section(
      "History snapshots",
      "Per-cycle frozen snapshots under <code>/history/</code> that feed the trends dashboard.",
      historyFiles,
      false
    ),
    section("Other files", "Everything else published at the site root.", otherFiles, false),
  ]
    .filter(Boolean)
    .join("\n");

  return `<!doctype html>
<html lang="en"><head>
${docHead("Everpure Research — Sitemap")}
</head>
<body>
${sidebar("sitemap", "../")}
<div class="shell"><div class="wrap">
<header>
  <h1>Sitemap</h1>
  <p class="sub">Every endpoint published by the build — generated by scanning the shipped site, so it lists exactly what GitHub Pages serves and never drifts.</p>
</header>

${sections}

<footer>Generated by <code>render_sitemap.js</code> from the built <code>publish/</code> tree — ${totalListed} endpoints across ${[primary, issuePages, issueArtifacts, otherPages, apiFiles, dataFiles, historyFiles, otherFiles].filter((g) => g.length).length} sections.</footer>
</div></div></body></html>`;
}

function main() {
  const root = path.resolve(process.argv[2] || ".");
  const outDir = path.join(root, "publish", "sitemap");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), render(root), "utf8");
  console.log(`Wrote ${path.join(outDir, "index.html")}`);
}

if (require.main === module) main();

module.exports = { render, labelFor, hrefFor, walk };
