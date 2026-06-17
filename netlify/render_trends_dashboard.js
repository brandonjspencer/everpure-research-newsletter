#!/usr/bin/env node
/**
 * Render the trends dashboard (the site homepage) from publish/data/trends.json.
 *
 * Self-contained HTML: shared branded theme (light/dark + collapsible sidebar)
 * from dashboard_theme.js + hand-rolled SVG charts whose fills are CSS variables
 * so they adapt to the active theme. No chart library, no React/Vite. Writes
 * publish/index.html (the homepage).
 *
 * Run: node netlify/render_trends_dashboard.js <repo-root>
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

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

// Stacked columns of confidence mix per cycle, with stat labels beneath.
function confidenceChart(cycles) {
  if (!cycles.length) return "<p class='empty'>No research cycles recorded yet.</p>";
  const W = 720;
  const H = 300;
  const padX = 48;
  const padTop = 16;
  const baseY = 230;
  const colW = 54;
  const gap = (W - padX * 2 - colW * cycles.length) / Math.max(1, cycles.length - 1 || 1);
  const maxTotal = Math.max(
    1,
    ...cycles.map((c) => {
      const b = c.confidence_breakdown || {};
      return (b.high || 0) + (b.medium || 0) + (b.low || 0) + (b.unknown || 0);
    })
  );
  const order = [
    ["high", "var(--c-high)"],
    ["medium", "var(--c-medium)"],
    ["low", "var(--c-low)"],
    ["unknown", "var(--c-unknown)"],
  ];
  let bars = "";
  cycles.forEach((c, i) => {
    const x = padX + i * (colW + gap);
    const b = c.confidence_breakdown || {};
    let y = baseY;
    for (const [key, color] of order) {
      const v = b[key] || 0;
      if (!v) continue;
      const h = ((baseY - padTop) * v) / maxTotal;
      y -= h;
      bars += `<rect x="${x}" y="${y.toFixed(1)}" width="${colW}" height="${h.toFixed(1)}" fill="${color}"><title>${esc(c.month)} — ${key}: ${v}</title></rect>`;
    }
    bars += `<text x="${x + colW / 2}" y="${baseY + 18}" class="axis" text-anchor="middle">${esc(c.month)}</text>`;
    const strength = c.avg_evidence_strength == null ? "—" : c.avg_evidence_strength;
    const findings = c.finding_count == null ? "—" : c.finding_count;
    bars += `<text x="${x + colW / 2}" y="${baseY + 34}" class="sub" text-anchor="middle">${c.concept_count} concepts</text>`;
    bars += `<text x="${x + colW / 2}" y="${baseY + 48}" class="sub" text-anchor="middle">${findings} findings · str ${strength}</text>`;
  });
  const legend = order
    .map(
      ([k, col]) =>
        `<span class="lg"><i style="background:${col}"></i>${k[0].toUpperCase() + k.slice(1)} confidence</span>`
    )
    .join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Confidence mix per cycle">${bars}</svg><div class="legend">${legend}</div>`;
}

// Distinct colors for the variants in a comparison (read on light + dark cards).
const VARIANT_COLORS = [
  "#9aa7b1",
  "#ef5b25",
  "#2e7d57",
  "#d98a00",
  "#7c6bd6",
  "#3a86c8",
  "#c2557a",
  "#1d9e88",
];

// Tidy a comparison title: drop leading test-number prefixes ("191 ") and
// collapse a trailing version on the variant side ("…Page V1" → "v1") so
// "191 EDC Success Blueprint Baseline vs 191 EDC Page V1" → "EDC Success
// Blueprint Baseline vs v1". Concept titles (no "vs", no number) pass through.
function succinctTitle(title) {
  return String(title || "")
    .split(/\s+vs\.?\s+/i)
    .map((part, i) => {
      const clean = part.replace(/^\d+\s+/, "").trim();
      if (i === 0) return clean;
      const m = clean.match(/\bv(?:ersion)?\s*([0-9]+)\b\s*$/i);
      return m ? `v${m[1]}` : clean;
    })
    .join(" vs ");
}

// Grouped bars across UX metrics for one comparison — one colored bar per variant.
function comparisonChart(title, n, variants, metricKeys, key) {
  // Render every metric actually present (live tests use success/satisfaction/
  // effort too), ordered by the canonical list, then any extras alphabetically.
  const present = new Set();
  for (const v of variants) for (const k of Object.keys(v.metrics || {})) present.add(k);
  const metrics = [
    ...metricKeys.filter((m) => present.has(m)),
    ...[...present].filter((m) => !metricKeys.includes(m)).sort(),
  ];
  const vars = variants.slice(0, 8);
  if (!metrics.length || !vars.length) return "";
  const W = 720;
  const labelW = 150;
  const valW = 40;
  const trackW = W - labelW - valW - 10;
  const barH = 7;
  const vgap = 3;
  const metricGap = 16;
  const blockH = vars.length * (barH + vgap);
  let y = 8;
  let rows = "";
  metrics.forEach((m) => {
    rows += `<text x="0" y="${y + blockH / 2}" class="mlabel" dominant-baseline="middle">${esc(m.replace(/_/g, " "))}</text>`;
    vars.forEach((v, vi) => {
      const by = y + vi * (barH + vgap);
      rows += `<rect x="${labelW}" y="${by}" width="${trackW}" height="${barH}" fill="var(--track)" rx="2"></rect>`;
      const score = v.metrics[m];
      if (typeof score === "number") {
        const w = (trackW * score) / 100;
        const color = VARIANT_COLORS[vi % VARIANT_COLORS.length];
        rows += `<rect x="${labelW}" y="${by}" width="${w.toFixed(1)}" height="${barH}" fill="${color}" rx="2"><title>${esc(v.test_name)} — ${m}: ${score}%</title></rect>`;
        rows += `<text x="${labelW + trackW + 6}" y="${by + barH}" class="mval">${score}%</text>`;
      }
    });
    y += blockH + metricGap;
  });
  const H = y;
  const legend = vars
    .map(
      (v, i) =>
        `<span class="lg"><i style="background:${VARIANT_COLORS[i % VARIANT_COLORS.length]}"></i>${esc(v.test_name)}</span>`
    )
    .join("");
  return `<div class="cmp" data-cmp="${esc(key || title)}"><div class="cmp-h"><strong>${esc(title)}</strong><span>${n ? `n=${n}` : ""}</span></div><div class="legend">${legend}</div><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} UX metrics">${rows}</svg></div>`;
}

function helioComparisons(helioMetrics) {
  // 1. Assemble compare pages (one per compare_id), deduping variants by test_id.
  const pages = new Map();
  for (const row of helioMetrics) {
    const id = row.compare_id || row.test_id;
    if (!pages.has(id)) pages.set(id, { id, rows: [] });
    pages.get(id).rows.push(row);
  }
  const pick = (rows, field) => (rows.find((r) => r[field]) || {})[field];
  const built = [];
  for (const p of pages.values()) {
    const comparisonTitle = pick(p.rows, "comparison_title") || null;
    const concept = pick(p.rows, "concept") || null;
    // Drop comparisons with no real label — the generic "Data Comparison" /
    // unlabeled records are confusing, so they're omitted rather than shown.
    if (!comparisonTitle && !concept) continue;
    const seen = new Set();
    const variants = [];
    for (const r of p.rows) {
      if (seen.has(r.test_id)) continue;
      seen.add(r.test_id);
      variants.push(r);
    }
    const ns = variants.map((v) => v.n).filter((x) => typeof x === "number");
    const withMetrics = variants.filter((v) => Object.keys(v.metrics || {}).length).length;
    const metricCount = new Set(variants.flatMap((v) => Object.keys(v.metrics || {}))).size;
    built.push({
      key: p.id,
      comparisonTitle,
      concept,
      variants,
      n: ns.length ? Math.max(...ns) : null,
      rank: withMetrics * 100 + metricCount,
    });
  }
  // 2. Titled comparisons (e.g. the EDC compare page) stay distinct; concept-only
  // ones collapse to a single block per concept — keep the most informative.
  const groups = new Map();
  for (const b of built) {
    const groupKey = b.comparisonTitle ? `T:${b.key}` : `C:${b.concept}`;
    const cur = groups.get(groupKey);
    if (!cur || b.rank > cur.rank) groups.set(groupKey, b);
  }
  return [...groups.values()].map((b) => {
    const title = succinctTitle(b.comparisonTitle || b.concept);
    return { key: b.key, title, label: title, variants: b.variants, n: b.n };
  });
}

function helioSection(helioMetrics, metricKeys) {
  if (!helioMetrics.length) {
    return `<p class="empty">No Helio comparisons captured yet — they appear here as the build ingests compare pages from the decks. Helio UX-metric trends start now and grow each cycle.</p>`;
  }
  const comparisons = helioComparisons(helioMetrics);
  const options = comparisons
    .map(
      (c) =>
        `<label class="ms-opt"><input type="checkbox" class="ms-cb" value="${esc(c.key)}" checked> <span>${esc(c.label)}</span></label>`
    )
    .join("");
  const control = `<div class="ms" data-ms="helio">
  <div class="ms-head"><span class="ms-title">Show comparisons</span><span class="ms-actions"><button type="button" class="ms-btn ms-all">All</button><button type="button" class="ms-btn ms-none">None</button></span></div>
  <div class="ms-opts">${options}</div>
</div>`;
  const blocks = comparisons
    .map((c) => comparisonChart(c.label, c.n, c.variants, metricKeys, c.key))
    .filter(Boolean)
    .join("\n");
  return `${control}<div class="cmp-list">${blocks}</div>${helioFilterScript()}`;
}

// Client-side filter: show only the checked comparisons, persisted to localStorage.
function helioFilterScript() {
  return `<script>(function(){
  var KEY="everpure-helio-show";
  var ms=document.querySelector('[data-ms="helio"]'); if(!ms) return;
  var cbs=[].slice.call(ms.querySelectorAll('.ms-cb'));
  function apply(){
    var sel={}; cbs.forEach(function(c){sel[c.value]=c.checked;});
    document.querySelectorAll('.cmp-list .cmp[data-cmp]').forEach(function(b){
      b.style.display = sel[b.getAttribute('data-cmp')]===false ? 'none' : '';
    });
    try{localStorage.setItem(KEY,JSON.stringify(sel));}catch(e){}
  }
  try{var s=JSON.parse(localStorage.getItem(KEY)||'null'); if(s){cbs.forEach(function(c){if(c.value in s)c.checked=!!s[c.value];});}}catch(e){}
  cbs.forEach(function(c){c.addEventListener('change',apply);});
  var all=ms.querySelector('.ms-all'),none=ms.querySelector('.ms-none');
  if(all)all.addEventListener('click',function(){cbs.forEach(function(c){c.checked=true;});apply();});
  if(none)none.addEventListener('click',function(){cbs.forEach(function(c){c.checked=false;});apply();});
  apply();
})();</script>`;
}

function quotesSection(quotes) {
  if (!quotes.length) return `<p class="empty">No respondent quotes captured yet.</p>`;
  return quotes
    .slice(-12)
    .reverse()
    .map(
      (q) =>
        `<figure class="quote"><blockquote>&ldquo;${esc(q.quote)}&rdquo;</blockquote><figcaption>${esc(q.title || "Research finding")} · ${esc(q.month)}${q.confidence && q.confidence !== "unknown" ? ` · ${esc(q.confidence)} confidence` : ""}</figcaption></figure>`
    )
    .join("\n");
}

function issuesSection(issues) {
  if (!issues.length) return `<p class="empty">No issues published yet.</p>`;
  const cards = issues
    .map((it) => {
      const tag = it.issue_label ? esc(it.issue_label) : `${it.finding_count} findings`;
      return `<a class="issue-hero" href="${esc(it.href)}">
  <div class="issue-hero-band"><span class="issue-hero-month">${esc(it.label)}</span><span class="issue-hero-tag">${tag}</span></div>
  <div class="issue-hero-body">
    <div class="issue-hero-title">${esc(it.title)}</div>
    <div class="issue-hero-foot"><span>${it.finding_count} findings</span><span class="go">Read issue →</span></div>
  </div>
</a>`;
    })
    .join("\n");
  return `<div class="issuegrid">${cards}</div>`;
}

function render(trends) {
  const cycles = trends.cycles || [];
  const metricKeys = trends.metric_keys || [];
  const latest = cycles[cycles.length - 1];
  const totalConcepts = new Set((trends.concepts || []).map((c) => c.key)).size;
  const generated = trends.generated_at ? trends.generated_at.slice(0, 10) : "";

  const kpis = [
    ["Cycles tracked", cycles.length],
    ["Concepts followed", totalConcepts],
    [
      "Helio comparisons",
      new Set((trends.helio_metrics || []).map((r) => r.comparison_title)).size,
    ],
    ["Latest cycle", latest ? latest.month : "—"],
  ]
    .map(
      ([label, v]) =>
        `<div class="kpi"><div class="kpi-v">${esc(v)}</div><div class="kpi-l">${esc(label)}</div></div>`
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head>
${docHead("Everpure Research — Trends")}
</head>
<body>
${sidebar("dashboard", "")}
<div class="shell"><div class="wrap">
<header>
  <h1>Research Trends</h1>
  <p class="sub">How the Everpure research program and its Helio UX signals move over time.${generated ? ` Built ${esc(generated)}.` : ""}</p>
</header>
<div class="kpis">${kpis}</div>

<section class="panel">
  <h2>Research program by cycle</h2>
  <p class="desc">Concepts evaluated each 30-day cycle, by evidence-backed confidence. Findings and average evidence strength noted beneath each column.</p>
  ${confidenceChart(cycles)}
</section>

<section class="panel">
  <h2>Helio UX metrics</h2>
  <p class="desc">Per-comparison UX scores (0–100) from the decks' Helio compare pages — baseline vs. the later variant. Higher is better.</p>
  ${helioSection(trends.helio_metrics || [], metricKeys)}
</section>

<section class="panel">
  <h2>Voice of the user</h2>
  <p class="desc">Verbatim respondent quotes carried through from the monthly issues.</p>
  ${quotesSection(trends.quotes || [])}
</section>

<section class="panel">
  <h2>Published issues</h2>
  <p class="desc">Each monthly Research Roundup — open the frozen issue.</p>
  ${issuesSection(trends.issues || [])}
</section>

<footer>
  Source: committed <code>history/</code> + <code>issues/</code> + Helio compare evidence, rolled up by <code>build_trends.js</code>. Helio UX-metric trends begin June 2026 and grow as comparisons are run.
</footer>
</div></div></body></html>`;
}

function main() {
  const root = path.resolve(process.argv[2] || ".");
  const trends = readJson(path.join(root, "publish", "data", "trends.json"));
  if (!trends) {
    console.error("No trends.json found; run build_trends.js first.");
    return;
  }
  const outDir = path.join(root, "publish");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), render(trends), "utf8");
  console.log(`Wrote ${path.join(outDir, "index.html")} (homepage)`);
}

if (require.main === module) main();

module.exports = {
  render,
  confidenceChart,
  comparisonChart,
  helioSection,
  helioComparisons,
  succinctTitle,
};
