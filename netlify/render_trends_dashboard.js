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

// Grouped bars (baseline vs later variant) across UX metrics for one comparison.
function comparisonChart(title, n, variants, metricKeys) {
  const metrics = metricKeys.filter((m) => variants.some((v) => typeof v.metrics[m] === "number"));
  if (!metrics.length) return "";
  const W = 720;
  const rowH = 30;
  const labelW = 150;
  const trackW = W - labelW - 70;
  let rows = "";
  metrics.forEach((m, i) => {
    const y = i * rowH + 8;
    rows += `<text x="0" y="${y + 14}" class="mlabel">${esc(m.replace(/_/g, " "))}</text>`;
    variants.slice(0, 2).forEach((v, vi) => {
      const score = v.metrics[m];
      if (typeof score !== "number") return;
      const barH = 9;
      const by = y + vi * (barH + 2);
      const w = (trackW * score) / 100;
      const color = vi === 0 ? "var(--bar-base)" : "var(--bar-variant)";
      rows += `<rect x="${labelW}" y="${by}" width="${trackW}" height="${barH}" fill="var(--track)" rx="2"></rect>`;
      rows += `<rect x="${labelW}" y="${by}" width="${w.toFixed(1)}" height="${barH}" fill="${color}" rx="2"><title>${esc(v.test_name)} — ${m}: ${score}%</title></rect>`;
      rows += `<text x="${labelW + trackW + 6}" y="${by + barH}" class="mval">${score}%</text>`;
    });
  });
  const H = metrics.length * rowH + 16;
  const names = variants
    .slice(0, 2)
    .map((v) => esc(v.test_name))
    .join(" → ");
  return `<div class="cmp"><div class="cmp-h"><strong>${esc(title)}</strong><span>${names}${n ? ` · n=${n}` : ""}</span></div><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} UX metrics">${rows}</svg></div>`;
}

function helioSection(helioMetrics, metricKeys) {
  if (!helioMetrics.length) {
    return `<p class="empty">No Helio comparisons captured yet — they appear here as the build ingests compare pages from the decks. Helio UX-metric trends start now and grow each cycle.</p>`;
  }
  const byCmp = new Map();
  for (const row of helioMetrics) {
    const key = row.comparison_title || row.concept || row.test_id;
    if (!byCmp.has(key)) byCmp.set(key, { title: key, n: row.n, variants: [] });
    byCmp.get(key).variants.push(row);
  }
  return [...byCmp.values()]
    .map((c) => comparisonChart(c.title, c.n, c.variants, metricKeys))
    .filter(Boolean)
    .join("\n");
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
      const sum = it.summary ? `<p class="issue-hero-sum">${esc(it.summary)}</p>` : "";
      return `<a class="issue-hero" href="${esc(it.href)}">
  <div class="issue-hero-band"><span class="issue-hero-month">${esc(it.label)}</span><span class="issue-hero-tag">${tag}</span></div>
  <div class="issue-hero-body">
    <div class="issue-hero-title">${esc(it.title)}</div>
    ${sum}
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

module.exports = { render, confidenceChart, comparisonChart, helioSection };
