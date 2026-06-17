#!/usr/bin/env node
/**
 * Render the static trends dashboard from publish/data/trends.json.
 *
 * Self-contained HTML: inline CSS + hand-rolled SVG charts + the data baked in
 * (no runtime fetch, no chart library, no React/Vite) — consistent with the
 * rest of the static builder. Writes publish/trends/index.html.
 *
 * Run: node netlify/render_trends_dashboard.js <repo-root>
 */
const fs = require("fs");
const path = require("path");

const C = {
  paper: "#fbf7f2",
  card: "#ffffff",
  ink: "#1d1d1f",
  muted: "#6b6b6b",
  line: "#ece6df",
  accent: "#ef5b25",
  high: "#2e7d57",
  medium: "#d98a00",
  low: "#c2410c",
  unknown: "#b8b2aa",
  baseline: "#9aa7b1",
  variant: "#ef5b25",
};

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
    ["high", C.high],
    ["medium", C.medium],
    ["low", C.low],
    ["unknown", C.unknown],
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
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Confidence mix per cycle">${bars}</svg><div class="legend">${legend}</div>`;
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
      const color = vi === 0 ? C.baseline : C.variant;
      rows += `<rect x="${labelW}" y="${by}" width="${trackW}" height="${barH}" fill="${C.line}" rx="2"></rect>`;
      rows += `<rect x="${labelW}" y="${by}" width="${w.toFixed(1)}" height="${barH}" fill="${color}" rx="2"><title>${esc(v.test_name)} — ${m}: ${score}%</title></rect>`;
      rows += `<text x="${labelW + trackW + 6}" y="${by + barH}" class="mval">${score}%</text>`;
    });
  });
  const H = metrics.length * rowH + 16;
  const names = variants
    .slice(0, 2)
    .map((v) => esc(v.test_name))
    .join(" → ");
  return `<div class="cmp"><div class="cmp-h"><strong>${esc(title)}</strong><span>${names}${n ? ` · n=${n}` : ""}</span></div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} UX metrics">${rows}</svg></div>`;
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
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Everpure Research — Trends</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{--ink:${C.ink};--muted:${C.muted};--paper:${C.paper};--card:${C.card};--line:${C.line};--accent:${C.accent}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:'Familjen Grotesk',system-ui,-apple-system,sans-serif;line-height:1.5}
  .wrap{max-width:880px;margin:0 auto;padding:32px 20px 64px}
  header h1{font-size:30px;margin:0 0 4px;letter-spacing:-.02em}
  header p{color:var(--muted);margin:0 0 24px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:0 0 28px}
  .kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .kpi-v{font-size:26px;font-weight:700;letter-spacing:-.02em}
  .kpi-l{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
  section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px 24px;margin:0 0 20px}
  section h2{font-size:18px;margin:0 0 4px;letter-spacing:-.01em}
  section .desc{color:var(--muted);font-size:13px;margin:0 0 16px}
  svg{width:100%;height:auto;display:block}
  text.axis{font-size:12px;fill:var(--ink);font-weight:600}
  text.sub{font-size:10px;fill:var(--muted)}
  text.mlabel{font-size:12px;fill:var(--ink);text-transform:capitalize}
  text.mval{font-size:11px;fill:var(--muted)}
  .legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:12px;color:var(--muted)}
  .lg i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:5px;vertical-align:-1px}
  .cmp{padding:14px 0;border-top:1px solid var(--line)}
  .cmp:first-child{border-top:0}
  .cmp-h{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:6px;flex-wrap:wrap}
  .cmp-h span{color:var(--muted);font-size:12px}
  .quote{margin:0 0 14px;padding:0 0 14px;border-bottom:1px solid var(--line)}
  .quote blockquote{margin:0 0 4px;font-size:15px}
  .quote figcaption{color:var(--muted);font-size:12px}
  .empty{color:var(--muted);font-size:14px;font-style:italic}
  footer{color:var(--muted);font-size:12px;margin-top:8px}
  a{color:var(--accent)}
</style></head>
<body><div class="wrap">
<header>
  <h1>Research Trends</h1>
  <p>How the Everpure research program and its Helio UX signals move over time.${generated ? ` Built ${esc(generated)}.` : ""}</p>
</header>
<div class="kpis">${kpis}</div>

<section>
  <h2>Research program by cycle</h2>
  <p class="desc">Concepts evaluated each 30-day cycle, by evidence-backed confidence. Findings and average evidence strength noted beneath each column.</p>
  ${confidenceChart(cycles)}
</section>

<section>
  <h2>Helio UX metrics</h2>
  <p class="desc">Per-comparison UX scores (0–100) from the decks' Helio compare pages — baseline vs. the later variant. Higher is better.</p>
  ${helioSection(trends.helio_metrics || [], metricKeys)}
</section>

<section>
  <h2>Voice of the user</h2>
  <p class="desc">Verbatim respondent quotes carried through from the monthly issues.</p>
  ${quotesSection(trends.quotes || [])}
</section>

<footer>Source: committed <code>history/</code> + <code>issues/</code> + Helio compare evidence, rolled up by <code>build_trends.js</code>. Helio UX-metric trends begin June 2026 and grow as comparisons are run.</footer>
</div></body></html>`;
}

function main() {
  const root = path.resolve(process.argv[2] || ".");
  const trends = readJson(path.join(root, "publish", "data", "trends.json"));
  if (!trends) {
    console.error("No trends.json found; run build_trends.js first.");
    return;
  }
  const outDir = path.join(root, "publish", "trends");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), render(trends), "utf8");
  console.log(`Wrote ${path.join(outDir, "index.html")}`);
}

if (require.main === module) main();

module.exports = { render, confidenceChart, comparisonChart, helioSection };
