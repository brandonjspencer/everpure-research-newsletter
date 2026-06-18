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

// Only allow http(s) URLs to become a clickable link. source_url is plumbed from a
// deck hyperlink target (author-authored, not build-controlled), so gate out any
// javascript:/data: scheme before it lands in an href. Returns null if unsafe.
function safeHref(u) {
  // Falsy/non-string in → null out (else String(null) === "null" would resolve to a
  // valid URL and leak href="null"/src="null" for missing source_url / thumbnail).
  if (typeof u !== "string" || !u) return null;
  try {
    return /^https?:$/.test(new URL(u, "https://_/").protocol) ? u : null;
  } catch {
    return null;
  }
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
// `url` (the Helio compare share page) renders a "View in Helio" link in the header.
function comparisonChart(title, n, variants, metricKeys, key, url) {
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
    .map((v, i) => {
      const sw = `<i style="background:${VARIANT_COLORS[i % VARIANT_COLORS.length]}"></i>`;
      const name = esc(v.test_name);
      const thumb = safeHref(v.thumbnail);
      // Hovering a variant with a screenshot pops its thumbnail (Helio compare page).
      if (!thumb) return `<span class="lg">${sw}${name}</span>`;
      // onerror: an expired/broken signed asset URL collapses the affordance back to a
      // plain legend item (Helio thumbnail URLs are time-signed and eventually 403).
      const onerr =
        "this.closest('.lg').classList.remove('has-thumb');this.closest('.thumb-pop').remove()";
      return `<span class="lg has-thumb">${sw}${name}<span class="thumb-pop"><img src="${esc(thumb)}" alt="${name} preview" loading="lazy" decoding="async" onerror="${onerr}"></span></span>`;
    })
    .join("");
  const href = safeHref(url);
  const meta = `<span class="cmp-h-r">${n ? `<span class="cmp-n">n=${n}</span>` : ""}${
    href
      ? `<a class="cmp-link" href="${esc(href)}" target="_blank" rel="noopener" aria-label="View ${esc(title)} comparison in Helio">View in Helio&nbsp;↗</a>`
      : ""
  }</span>`;
  return `<div class="cmp" data-cmp="${esc(key || title)}"><div class="cmp-h"><strong>${esc(title)}</strong>${meta}</div><div class="legend">${legend}</div><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} UX metrics">${rows}</svg></div>`;
}

// Trust a slide-inferred concept as the comparison's label ONLY when the page's own
// screen-derived title corroborates it (shares a meaningful word). With no derived
// title we trust the concept (legacy behavior); when the derived title contradicts
// the concept (e.g. a Knowledge-Portal page mis-inferred as "EDC Success Blueprint")
// we don't — the page-derived title wins instead.
const TITLE_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "vs",
  "and",
  "or",
  "of",
  "for",
  "to",
  "page",
  "v1",
  "v2",
  "v3",
  "baseline",
  "variant",
  "default",
  "new",
  "old",
  "test",
  "data",
  "comparison",
]);
function titleWords(s) {
  return new Set(
    (
      String(s || "")
        .toLowerCase()
        .match(/[a-z0-9]+/g) || []
    ).filter((w) => w.length > 2 && !TITLE_STOPWORDS.has(w))
  );
}
function conceptTrusted(concept, derivedTitle) {
  if (!concept) return false;
  if (!derivedTitle) return true; // no page evidence either way → trust the concept
  const cw = titleWords(concept);
  const dw = titleWords(derivedTitle);
  for (const w of cw) if (dw.has(w)) return true;
  return false;
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
    const derivedTitle = pick(p.rows, "derived_title") || null;
    const sourceUrl = pick(p.rows, "source_url") || null;
    // Drop comparisons with no real label — the generic "Data Comparison" /
    // unlabeled records are confusing, so they're omitted rather than shown.
    if (!comparisonTitle && !concept) continue;
    // Dedup variants by test_id, keeping the NEWEST cycle's row (freshest metrics +
    // freshly-signed thumbnail) while preserving first-seen legend order. Rows carry
    // `month` as YYYY-MM, so a lexicographic compare orders cycles.
    const byTest = new Map();
    for (const r of p.rows) {
      const cur = byTest.get(r.test_id);
      if (!cur || String(r.month || "") > String(cur.month || "")) byTest.set(r.test_id, r);
    }
    const variants = [...byTest.values()];
    const ns = variants.map((v) => v.n).filter((x) => typeof x === "number");
    const withMetrics = variants.filter((v) => Object.keys(v.metrics || {}).length).length;
    const metricCount = new Set(variants.flatMap((v) => Object.keys(v.metrics || {}))).size;
    built.push({
      key: p.id,
      comparisonTitle,
      concept,
      derivedTitle,
      trusted: conceptTrusted(concept, derivedTitle),
      url: sourceUrl,
      variants,
      rows: p.rows,
      n: ns.length ? Math.max(...ns) : null,
      rank: withMetrics * 100 + metricCount,
    });
  }
  // 2. Titled comparisons (e.g. the EDC compare page) stay distinct; concept-only
  // ones collapse to a single block per concept — keep the most informative one for
  // display, but aggregate ALL rows in the group so the cross-cycle metric series
  // spans every month the concept was measured (often a different compare page each
  // cycle).
  const groups = new Map();
  for (const b of built) {
    // Real "<A> vs B" titles stay distinct (T:); a trusted concept collapses its
    // duplicates (C:); an untrusted concept-only page (the label doesn't match the
    // page) stays distinct under its own key (D:) so it isn't merged under a wrong
    // concept and is labeled from the page itself.
    const groupKey = b.comparisonTitle ? `T:${b.key}` : b.trusted ? `C:${b.concept}` : `D:${b.key}`;
    const cur = groups.get(groupKey);
    if (!cur) {
      groups.set(groupKey, { rep: b, rows: [...b.rows] });
    } else {
      cur.rows.push(...b.rows);
      if (b.rank > cur.rep.rank) cur.rep = b;
    }
  }
  return [...groups.values()].map(({ rep, rows }) => {
    const title = succinctTitle(
      rep.comparisonTitle || (rep.trusted ? rep.concept : rep.derivedTitle || rep.concept)
    );
    return {
      key: rep.key,
      title,
      label: title,
      variants: rep.variants,
      n: rep.n,
      url: rep.url,
      trends: metricTrends(rep.variants, rows),
    };
  });
}

// The two UX signals tracked as sparklines (per the dashboard's editorial focus).
const METRIC_TREND_KEYS = ["comprehension", "sentiment"];
const METRIC_TREND_LABELS = { comprehension: "Comprehension", sentiment: "Sentiment" };

// For each tracked metric, two series: `variants` = baseline→latest within the most
// recent cycle (populated now); `cycles` = one point per month (max across that
// month's variants), which fills in as Helio history accrues.
function metricTrends(variants, rows) {
  const out = {};
  for (const m of METRIC_TREND_KEYS) {
    const variantVals = (variants || [])
      .map((v) => (v.metrics || {})[m])
      .filter((x) => typeof x === "number");
    const byMonth = new Map();
    for (const r of rows || []) {
      const val = (r.metrics || {})[m];
      if (typeof val !== "number" || !r.month) continue;
      byMonth.set(r.month, Math.max(byMonth.get(r.month) ?? -Infinity, val));
    }
    const cycles = [...byMonth.entries()]
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([month, value]) => ({ month, value }));
    out[m] = { variants: variantVals, cycles };
  }
  return out;
}

// Tiny inline-SVG sparkline for a 0–100 series. A single point renders as a dot.
function sparkline(values, color) {
  const vals = (values || []).filter((v) => typeof v === "number");
  if (!vals.length) return "";
  const W = 84;
  const H = 22;
  const pad = 3;
  const stroke = color || "var(--muted)";
  const x = (i) => (vals.length === 1 ? W / 2 : pad + ((W - pad * 2) * i) / (vals.length - 1));
  const y = (v) => H - pad - ((H - pad * 2) * Math.max(0, Math.min(100, v))) / 100;
  const last = vals[vals.length - 1];
  const dot = `<circle cx="${x(vals.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="2.4" fill="${stroke}"></circle>`;
  if (vals.length === 1) {
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="single reading ${last}">${dot}</svg>`;
  }
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="trend ${vals[0]} to ${last}"><polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.6"></polyline>${dot}</svg>`;
}

function metricTrendsSection(comparisons) {
  const rows = comparisons.filter(
    (c) =>
      c.trends &&
      METRIC_TREND_KEYS.some((m) => c.trends[m].variants.length || c.trends[m].cycles.length)
  );
  if (!rows.length) {
    return `<p class="empty">No comprehension or sentiment scores captured yet — they appear as Helio comparisons are ingested.</p>`;
  }
  const blocks = rows
    .map((c) => {
      const metricRows = METRIC_TREND_KEYS.map((m) => {
        const t = c.trends[m];
        if (!t.variants.length && !t.cycles.length) return "";
        const vals = t.variants;
        const first = vals[0];
        const last = vals[vals.length - 1];
        const delta = vals.length >= 2 ? Math.round(last - first) : null;
        const dColor =
          delta == null
            ? "var(--muted)"
            : delta > 0
              ? "var(--c-high)"
              : delta < 0
                ? "var(--c-low)"
                : "var(--muted)";
        const arrow = delta == null ? "" : delta > 0 ? "▲" : delta < 0 ? "▼" : "–";
        const deltaStr =
          delta == null
            ? ""
            : ` <span class="mt-delta" style="color:${dColor}">${arrow} ${delta > 0 ? "+" : ""}${delta}</span>`;
        const valStr = vals.length ? (vals.length > 1 ? `${first} → ${last}` : `${last}`) : "—";
        const cyc =
          t.cycles.length >= 2
            ? `<span class="mt-cyc" title="${t.cycles.length} cycles">${sparkline(
                t.cycles.map((p) => p.value),
                "var(--accent)"
              )}<span>${t.cycles.length} cycles</span></span>`
            : `<span class="mt-cyc mt-soon">trend accrues monthly</span>`;
        return `<div class="mt-metric"><span class="mt-label">${METRIC_TREND_LABELS[m]}</span>${sparkline(
          vals,
          dColor
        )}<span class="mt-val">${valStr}${deltaStr}</span>${cyc}</div>`;
      })
        .filter(Boolean)
        .join("");
      return `<div class="mt-row"><div class="mt-name">${esc(c.title)}</div>${metricRows}</div>`;
    })
    .join("\n");
  return `<div class="mtrends">${blocks}</div>`;
}

function helioSection(helioMetrics, metricKeys) {
  if (!helioMetrics.length) {
    return `<p class="empty">No Helio comparisons captured yet — they appear here as the build ingests compare pages from the decks. Helio UX-metric trends start now and grow each cycle.</p>`;
  }
  const comparisons = helioComparisons(helioMetrics);
  const count = comparisons.length;
  const options = comparisons
    .map((c) => {
      const href = safeHref(c.url);
      const link = href
        ? `<a class="ms-opt-link" href="${esc(href)}" target="_blank" rel="noopener" aria-label="Open ${esc(c.label)} comparison in Helio" title="View in Helio">↗</a>`
        : "";
      return `<div class="ms-opt"><label class="ms-opt-main"><input type="checkbox" class="ms-cb" value="${esc(c.key)}" checked> <span class="ms-opt-name">${esc(c.label)}</span></label>${link}</div>`;
    })
    .join("");
  // A dropdown multiselect: a toggle button (with a live "N of M" count) opens a
  // popover of per-comparison checkboxes, each linking out to its Helio compare page.
  const control = `<div class="ms" data-ms="helio">
  <button type="button" class="ms-toggle" aria-expanded="false" aria-controls="ms-panel-helio"><span class="ms-label">Show comparisons</span> <span class="ms-count">${count} of ${count}</span> <span class="ms-caret" aria-hidden="true">▾</span></button>
  <div class="ms-panel" id="ms-panel-helio" role="group" aria-label="Filter Helio comparisons" hidden>
    <div class="ms-head"><button type="button" class="ms-btn ms-all">All</button><button type="button" class="ms-btn ms-none">None</button></div>
    <div class="ms-opts">${options}</div>
  </div>
</div>`;
  const blocks = comparisons
    .map((c) => comparisonChart(c.label, c.n, c.variants, metricKeys, c.key, c.url))
    .filter(Boolean)
    .join("\n");
  return `${control}<div class="cmp-list">${blocks}</div>${helioFilterScript()}`;
}

// Client-side dropdown multiselect: a toggle opens a checkbox popover (close on
// outside click / Escape); only checked comparisons stay visible, persisted to
// localStorage, with a live count on the button.
function helioFilterScript() {
  return `<script>(function(){
  var KEY="everpure-helio-show";
  var ms=document.querySelector('[data-ms="helio"]'); if(!ms) return;
  var toggle=ms.querySelector('.ms-toggle'), panel=ms.querySelector('.ms-panel'), count=ms.querySelector('.ms-count');
  var cbs=[].slice.call(ms.querySelectorAll('.ms-cb'));
  function apply(){
    var sel={}; cbs.forEach(function(c){sel[c.value]=c.checked;});
    document.querySelectorAll('.cmp-list .cmp[data-cmp]').forEach(function(b){
      b.style.display = sel[b.getAttribute('data-cmp')]===false ? 'none' : '';
    });
    if(count) count.textContent = cbs.filter(function(c){return c.checked;}).length + ' of ' + cbs.length;
    try{localStorage.setItem(KEY,JSON.stringify(sel));}catch(e){}
  }
  try{var s=JSON.parse(localStorage.getItem(KEY)||'null'); if(s){cbs.forEach(function(c){if(c.value in s)c.checked=!!s[c.value];});}}catch(e){}
  cbs.forEach(function(c){c.addEventListener('change',apply);});
  var all=ms.querySelector('.ms-all'),none=ms.querySelector('.ms-none');
  if(all)all.addEventListener('click',function(){cbs.forEach(function(c){c.checked=true;});apply();});
  if(none)none.addEventListener('click',function(){cbs.forEach(function(c){c.checked=false;});apply();});
  if(toggle&&panel){
    function open(){panel.hidden=false;toggle.setAttribute('aria-expanded','true');}
    function close(){panel.hidden=true;toggle.setAttribute('aria-expanded','false');}
    toggle.addEventListener('click',function(e){e.stopPropagation();if(panel.hidden)open();else close();});
    panel.addEventListener('click',function(e){e.stopPropagation();});
    document.addEventListener('click',function(){if(!panel.hidden)close();});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!panel.hidden){close();toggle.focus();}});
  }
  apply();
})();</script>`;
}

// Feature the few most recent respondent quotes as a cross-fading rotator.
const QUOTE_ROTATOR_MAX = 5;

function quoteFigure(q, active) {
  // aria-hidden tracks the visual state so assistive tech reads only the active
  // quote — opacity:0 alone leaves inactive slides in the accessibility tree. The
  // render-time value also covers the no-JS / reduced-motion stacked case.
  return `<figure class="quote q-slide${active ? " is-active" : ""}" aria-hidden="${active ? "false" : "true"}"><blockquote>&ldquo;${esc(q.quote)}&rdquo;</blockquote><figcaption>${esc(q.title || "Research finding")} · ${esc(q.month)}${q.confidence && q.confidence !== "unknown" ? ` · ${esc(q.confidence)} confidence` : ""}</figcaption></figure>`;
}

function quotesSection(quotes) {
  if (!quotes.length) return `<p class="empty">No respondent quotes captured yet.</p>`;
  // Newest first, capped to a small set that cross-fades from one to the next.
  const featured = quotes.slice().reverse().slice(0, QUOTE_ROTATOR_MAX);
  if (featured.length === 1) {
    return `<div class="qrotator"><div class="q-stage">${quoteFigure(featured[0], true)}</div></div>`;
  }
  const slides = featured.map((q, i) => quoteFigure(q, i === 0)).join("");
  const dots = featured
    .map(
      (q, i) =>
        `<button type="button" class="q-dot${i === 0 ? " is-active" : ""}" data-i="${i}" aria-current="${i === 0 ? "true" : "false"}" aria-label="Show quote ${i + 1} of ${featured.length}"></button>`
    )
    .join("");
  return `<div class="qrotator" data-qrotator><div class="q-stage">${slides}</div><div class="q-dots">${dots}</div></div>${quoteRotatorScript()}`;
}

// Auto cross-fade through the featured quotes; pause on hover/focus; honor
// prefers-reduced-motion (no auto-advance — dots still work); dots jump directly.
function quoteRotatorScript() {
  return `<script>(function(){
  var r=document.querySelector('[data-qrotator]'); if(!r) return;
  var slides=[].slice.call(r.querySelectorAll('.q-slide')), dots=[].slice.call(r.querySelectorAll('.q-dot'));
  if(slides.length<2) return;
  var i=0, timer=null, reduce=false, paused=false;
  try{reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(e){}
  function show(n){i=(n+slides.length)%slides.length;
    slides.forEach(function(s,k){var on=k===i;s.classList.toggle('is-active',on);s.setAttribute('aria-hidden',on?'false':'true');});
    dots.forEach(function(d,k){var on=k===i;d.classList.toggle('is-active',on);d.setAttribute('aria-current',on?'true':'false');});
  }
  function stop(){if(timer){clearInterval(timer);timer=null;}}
  function start(){stop();if(!reduce&&!paused)timer=setInterval(function(){show(i+1);},6000);}
  function pause(){paused=true;stop();}
  function resume(){paused=false;start();}
  dots.forEach(function(d,k){d.addEventListener('click',function(){show(k);start();});});
  r.addEventListener('mouseenter',pause); r.addEventListener('mouseleave',resume);
  r.addEventListener('focusin',pause); r.addEventListener('focusout',resume);
  start();
})();</script>`;
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
  <h2>Comprehension &amp; sentiment</h2>
  <p class="desc">The two signals to watch — how each comparison moves from baseline to the latest variant (left), and across cycles as Helio history accrues (right).</p>
  ${metricTrendsSection(helioComparisons(trends.helio_metrics || []))}
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
  metricTrends,
  metricTrendsSection,
  sparkline,
  succinctTitle,
};
