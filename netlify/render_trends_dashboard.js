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

// Stacked columns of confidence mix per cycle, with stat labels beneath. Rendered
// as HTML/CSS (not SVG) so labels stay legible and the layout reflows on mobile.
function confidenceChart(cycles) {
  if (!cycles.length) return "<p class='empty'>No research cycles recorded yet.</p>";
  const order = [
    ["high", "var(--c-high)"],
    ["medium", "var(--c-medium)"],
    ["low", "var(--c-low)"],
    ["unknown", "var(--c-unknown)"],
  ];
  const maxTotal = Math.max(
    1,
    ...cycles.map((c) => {
      const b = c.confidence_breakdown || {};
      return (b.high || 0) + (b.medium || 0) + (b.low || 0) + (b.unknown || 0);
    })
  );
  const cols = cycles
    .map((c) => {
      const b = c.confidence_breakdown || {};
      // column-reverse stacks the first child (high) at the bottom; height is the
      // count as a % of the busiest cycle, so shorter cycles read as shorter columns.
      const segs = order
        .map(([k, col]) => {
          const v = b[k] || 0;
          if (!v) return "";
          return `<div class="cseg" style="height:${((v / maxTotal) * 100).toFixed(1)}%;background:${col}" title="${esc(c.month)} — ${k}: ${v}"></div>`;
        })
        .join("");
      const strength = c.avg_evidence_strength == null ? "—" : c.avg_evidence_strength;
      const findings = c.finding_count == null ? "—" : c.finding_count;
      return `<div class="ccol"><div class="ccol-bar"><div class="ccol-stack">${segs}</div></div><div class="ccol-x">${esc(c.month)}</div><div class="ccol-sub">${c.concept_count} concepts</div><div class="ccol-sub">${findings} findings · str ${strength}</div></div>`;
    })
    .join("");
  const legend = order
    .map(
      ([k, col]) =>
        `<span class="lg"><i style="background:${col}"></i>${k[0].toUpperCase() + k.slice(1)} confidence</span>`
    )
    .join("");
  return `<div class="ccols" role="img" aria-label="Confidence mix per cycle">${cols}</div><div class="legend">${legend}</div>`;
}

// Distinct colors for the variants in a comparison (read on light + dark cards).
// Deliberately NO red-orange: a warning hue on a neutral data series (often the
// *winning* variant) reads as "bad". Calm, neutral-to-positive hues instead.
const VARIANT_COLORS = [
  "#9aa7b1", // baseline — neutral slate gray
  "#3a86c8", // blue (was red-orange) — calm for the primary variant
  "#2e7d57", // green
  "#d98a00", // amber
  "#7c6bd6", // purple
  "#1d9e88", // teal
  "#c2557a", // rose
  "#7a8b3a", // olive
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
// `lead` (prebuilt HTML) renders inside the card just under the header, BEFORE the
// legend + bars — the frontrunner + signal block, so the takeaway is read first — and
// it's hidden together with the chart by the multiselect filter.
function comparisonChart(title, n, variants, metricKeys, key, url, lead = "") {
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
  // HTML/CSS bars (not SVG): one colored bar per variant per metric. Labels and
  // values are real text, so nothing shrinks — the grid reflows to stacked on mobile.
  const bars = metrics
    .map((m) => {
      const rows = vars
        .map((v, vi) => {
          const score = v.metrics[m];
          if (typeof score !== "number") return "";
          const color = VARIANT_COLORS[vi % VARIANT_COLORS.length];
          return `<div class="mc-row" title="${esc(v.test_name)} — ${esc(m)}: ${score}%"><div class="mc-track"><div class="mc-fill" style="width:${score}%;background:${color}"></div></div><span class="mc-val">${score}%</span></div>`;
        })
        .join("");
      return `<div class="mc-metric"><div class="mc-label">${esc(m.replace(/_/g, " "))}</div><div class="mc-bars">${rows}</div></div>`;
    })
    .join("");
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
  return `<div class="cmp" data-cmp="${esc(key || title)}"><div class="cmp-h"><strong>${esc(title)}</strong>${meta}</div>${lead || ""}<div class="legend">${legend}</div><div class="mc" role="img" aria-label="${esc(title)} UX metrics">${bars}</div></div>`;
}

// Average a variant's present metric scores (its own denominator). overall_score is a
// Helio roll-up of the others, so it's excluded from the mean to avoid double-counting
// (it still renders as a bar and can still be the biggest mover). Returns null if none.
function variantMean(metrics) {
  const all = Object.keys(metrics || {});
  const keys = all.filter((k) => k !== "overall_score");
  const use = (keys.length ? keys : all)
    .map((k) => metrics[k])
    .filter((x) => typeof x === "number");
  if (!use.length) return null;
  return use.reduce((a, b) => a + b, 0) / use.length;
}

// Humanize a metric key for inline prose ("overall_score" → "overall score").
function metricName(k) {
  return String(k || "").replace(/_/g, " ");
}

// Pure: which variant leads a comparison, by how much, and where. Returns null when
// there's no head-to-head (fewer than two variants carrying metrics). Higher is better
// for every Helio UX metric (0–100). Baseline = the variant named "…Baseline", else the
// first (Helio returns baseline-first take order). The frontrunner is the highest mean;
// when that's the baseline itself, the variants regressed (baselineWins).
function comparisonFrontrunner(variants) {
  const vs = (variants || [])
    .map((v) => ({
      name: v.test_name || "",
      metrics: v.metrics || {},
      mean: variantMean(v.metrics),
    }))
    .filter((v) => typeof v.mean === "number");
  if (vs.length < 2) return null;
  const baseline = vs.find((v) => /baseline/i.test(v.name)) || vs[0];
  let winner = vs[0];
  for (const v of vs) if (v.mean > winner.mean) winner = v;
  const baselineWins = winner === baseline;
  // Count metrics where the winner is the strict top scorer (only metrics ≥2 variants
  // actually scored, so a metric only one variant has doesn't inflate the lead count).
  const metricKeys = [...new Set(vs.flatMap((v) => Object.keys(v.metrics)))];
  let leads = 0;
  let total = 0;
  for (const k of metricKeys) {
    const scored = vs.map((v) => v.metrics[k]).filter((x) => typeof x === "number");
    if (scored.length < 2) continue;
    total += 1;
    if (typeof winner.metrics[k] === "number" && winner.metrics[k] === Math.max(...scored))
      leads += 1;
  }
  // Biggest mover winner−baseline (signed), to name the headline metric.
  let biggest = null;
  for (const k of metricKeys) {
    const w = winner.metrics[k];
    const b = baseline.metrics[k];
    if (typeof w !== "number" || typeof b !== "number") continue;
    const delta = w - b;
    if (!biggest || Math.abs(delta) > Math.abs(biggest.delta)) biggest = { metric: k, delta };
  }
  const challengers = vs.filter((v) => v !== baseline);
  const bestChallenger = challengers.length
    ? challengers.reduce((a, b) => (b.mean > a.mean ? b : a))
    : null;
  return {
    winnerName: winner.name,
    baselineName: baseline.name,
    baselineWins,
    avgLift: Math.round(winner.mean - baseline.mean),
    trailGap:
      baselineWins && bestChallenger ? Math.round(baseline.mean - bestChallenger.mean) : null,
    bestChallengerName: baselineWins && bestChallenger ? bestChallenger.name : null,
    leads,
    total,
    biggest,
    variantCount: vs.length,
  };
}

// Find the curated signal for a comparison: exact compare_id (key) match first, then a
// case-insensitive substring of the comparison's display title. Title-only (not concept)
// so an inferred concept shared by two cards can't cross-match. First match wins.
function matchUxSignal(comparison, uxSignals) {
  const key = String(comparison.key || "").toLowerCase();
  const title = String(comparison.title || comparison.label || "").toLowerCase();
  for (const s of uxSignals || []) {
    const m = String(s.match || "")
      .toLowerCase()
      .trim();
    if (!m) continue;
    if (m === key || (m.length >= 3 && title.includes(m))) return s;
  }
  return null;
}

// The block rendered just above a comparison's chart: a deterministic frontrunner line
// (always, when there's a head-to-head) plus the signal — the curated editorial read
// when authored, else a computed fallback from the frontrunner stats. Curated signals
// may add a one-line recommendation. Returns "" when there's nothing to say.
function frontrunnerBlock(comparison, uxSignals) {
  const fr = comparisonFrontrunner(comparison.variants);
  const curated = matchUxSignal(comparison, uxSignals);
  const parts = [];
  if (fr) {
    let line;
    if (fr.baselineWins) {
      const trail =
        fr.bestChallengerName && fr.trailGap != null
          ? `; best variant (${esc(fr.bestChallengerName)}) trails by ${fr.trailGap} avg`
          : "";
      line = `<span class="cf-name">${esc(fr.baselineName)}</span> <span class="cf-stat">still leads — variants regressed${trail}</span>`;
    } else {
      const leadStr = fr.total ? ` · leads ${fr.leads}/${fr.total} metrics` : "";
      const big =
        fr.biggest && fr.biggest.delta !== 0
          ? ` · biggest ${fr.biggest.delta > 0 ? "lift" : "drop"} ${esc(metricName(fr.biggest.metric))} ${fr.biggest.delta > 0 ? "+" : ""}${fr.biggest.delta}`
          : "";
      line = `<span class="cf-name">${esc(fr.winnerName)}</span> <span class="cf-stat"><span class="cf-up">+${fr.avgLift} avg</span>${leadStr}${big} vs baseline</span>`;
    }
    parts.push(`<p class="cmp-front"><span class="cmp-front-label">Frontrunner</span> ${line}</p>`);
  } else if ((comparison.variants || []).length < 2) {
    parts.push(
      `<p class="cmp-front cmp-front-solo"><span class="cmp-front-label">Single screen</span> <span class="cf-stat">no head-to-head comparison</span></p>`
    );
  }
  // Signal: curated editorial read, else a computed fallback (plain text, esc'd once).
  let signalText = curated ? curated.signal : "";
  if (!signalText && fr) {
    if (fr.baselineWins) {
      signalText = `Variants regressed — the baseline still scores highest${
        fr.bestChallengerName ? `; ${fr.bestChallengerName} is the closest challenger` : ""
      }.`;
    } else {
      const big =
        fr.biggest && fr.biggest.delta > 0
          ? ` Biggest gain: ${metricName(fr.biggest.metric)} +${fr.biggest.delta}.`
          : "";
      signalText = `${fr.winnerName} leads ${fr.leads} of ${fr.total} metrics (+${fr.avgLift} avg vs baseline).${big}`;
    }
  }
  if (signalText) {
    parts.push(
      `<p class="cmp-signal"><span class="cmp-signal-label">Signal</span> ${esc(signalText)}</p>`
    );
  }
  if (curated && curated.recommendation) {
    parts.push(
      `<p class="cmp-rec"><span class="cmp-rec-label">Next</span> ${esc(curated.recommendation)}</p>`
    );
  }
  return parts.length ? `<div class="cmp-lead">${parts.join("")}</div>` : "";
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

// Map each compare_id → the same succinct comparison title the cards use, so a
// "Voice of the user" quote can be labeled with the screen/comparison it's about.
// Mirrors the title precedence in helioComparisons (page title › trusted concept ›
// page-derived screen name), keyed per compare page rather than per display group.
function helioTitleById(helioMetrics) {
  const byId = new Map();
  for (const row of helioMetrics || []) {
    const id = row.compare_id || row.test_id;
    if (!id) continue;
    const e = byId.get(id) || {};
    e.comparison_title = e.comparison_title || row.comparison_title || null;
    e.concept = e.concept || row.concept || null;
    e.derived_title = e.derived_title || row.derived_title || null;
    byId.set(id, e);
  }
  const out = {};
  for (const [id, e] of byId) {
    const raw =
      e.comparison_title ||
      (conceptTrusted(e.concept, e.derived_title) ? e.concept : e.derived_title || e.concept);
    const title = succinctTitle(raw);
    if (title) out[id] = title;
  }
  return out;
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
                "#3a86c8"
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

function helioSection(helioMetrics, metricKeys, uxSignals) {
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
    .map((c) =>
      comparisonChart(
        c.label,
        c.n,
        c.variants,
        metricKeys,
        c.key,
        c.url,
        frontrunnerBlock(c, uxSignals)
      )
    )
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

// Show up to QUOTE_ROTATOR_MAX quotes at a time in the rotator, freshly shuffled in
// from a larger embedded pool on each load (so refreshing surfaces different ones).
const QUOTE_ROTATOR_MAX = 5;
const QUOTE_POOL_MAX = 24;
// In curated mode every flagged signal should appear (not a random 5), capped so the
// rotation stays digestible.
const QUOTE_CURATED_MAX = 8;

// Resolve what each quote is ABOUT (topic) and WHO said it, for the caption.
// A Helio verbatim → the comparison/screen it's about (+ "Research participant");
// a curated finding quote → the finding title is itself the topic; a generic deck
// open-end → just "Research participant". Returns a lean embed-ready entry.
function resolveQuoteTopic(q, titleById) {
  const fromCompare = q.compare_id ? titleById[q.compare_id] : null;
  // Topic precedence: a curated entry carries its own; a Helio quote resolves it from
  // compare_id; a finding quote's title IS its topic; a deck open-end has neither.
  let topic = q.topic || fromCompare || null;
  let who = null;
  if (topic) {
    who = q.title && q.title !== "Research participant" ? null : "Research participant";
  } else if (q.title && q.title !== "Research participant") {
    topic = q.title;
  } else {
    who = q.title || "Research participant";
  }
  return {
    quote: q.quote,
    month: q.month,
    confidence: q.confidence,
    topic,
    who,
    question: q.question ? shortQuestion(q.question) : null,
    signal: q.signal || null,
  };
}

// The survey prompt shown above a quote — trimmed at a word boundary so a long
// open-ended question doesn't dominate the rotator.
function shortQuestion(text, maxLen = 150) {
  const s = String(text || "").trim();
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 60 ? cut.slice(0, sp) : cut).replace(/[\s,.;:]+$/, "")}…`;
}

function quoteFigure(q, active) {
  // aria-hidden tracks the visual state so assistive tech reads only the active
  // quote — opacity:0 alone leaves inactive slides in the accessibility tree. The
  // render-time value also covers the no-JS / reduced-motion stacked case.
  const conf = q.confidence && q.confidence !== "unknown" ? `${q.confidence} confidence` : "";
  const parts = [];
  if (q.topic) parts.push(`<span class="q-topic">${esc(q.topic)}</span>`);
  if (q.who) parts.push(esc(q.who));
  if (q.month) parts.push(esc(q.month));
  if (conf) parts.push(esc(conf));
  // The eyebrow above the quote: the curated signal (the pattern it represents) when
  // present, else the survey question it answered.
  const eyebrow = q.signal
    ? `<p class="q-signal"><span class="q-signal-label">Signal</span> ${esc(q.signal)}</p>`
    : q.question
      ? `<p class="q-prompt"><span class="q-prompt-label">Asked</span> ${esc(q.question)}</p>`
      : "";
  return `<figure class="quote q-slide${active ? " is-active" : ""}" aria-hidden="${active ? "false" : "true"}">${eyebrow}<blockquote>&ldquo;${esc(q.quote)}&rdquo;</blockquote><figcaption>${parts.join(" · ")}</figcaption></figure>`;
}

function quotesSection(quotes, helioMetrics, mode) {
  if (!quotes.length) return `<p class="empty">No respondent quotes captured yet.</p>`;
  const titleById = helioTitleById(helioMetrics || []);
  const curated = mode === "curated";
  // Curated mode shows every flagged signal; harvested mode samples the larger pool.
  const pool = (curated ? quotes : quotes.slice(0, QUOTE_POOL_MAX)).map((q) =>
    resolveQuoteTopic(q, titleById)
  );
  const max = curated ? Math.min(pool.length, QUOTE_CURATED_MAX) : QUOTE_ROTATOR_MAX;
  // SSR one quote as the no-JS fallback; the script shuffles the embedded pool and
  // rotates a fresh set in on each load.
  const ssr = quoteFigure(pool[0], true);
  const payload = JSON.stringify(pool).replace(/</g, "\\u003c");
  return `<div class="qrotator" data-qrotator><div class="q-stage">${ssr}</div><div class="q-dots"></div><script type="application/json" data-quotes>${payload}</script></div>${quoteRotatorScript(max)}`;
}

// On load: shuffle the embedded pool, build up to MAX slides + dots, then auto
// cross-fade; pause on hover/focus; honor prefers-reduced-motion; dots jump directly.
function quoteRotatorScript(max = QUOTE_ROTATOR_MAX) {
  return `<script>(function(){
  var r=document.querySelector('[data-qrotator]'); if(!r) return;
  var stage=r.querySelector('.q-stage'), dotsWrap=r.querySelector('.q-dots'), data=r.querySelector('[data-quotes]');
  var pool=[]; try{pool=JSON.parse((data&&data.textContent)||'[]')||[];}catch(e){}
  var MAX=${max};
  if(pool.length>1){
    for(var a=pool.length-1;a>0;a--){var b=Math.floor(Math.random()*(a+1));var t=pool[a];pool[a]=pool[b];pool[b]=t;}
    var pick=pool.slice(0,MAX);
    stage.textContent=''; dotsWrap.textContent='';
    pick.forEach(function(q,idx){
      var on=idx===0;
      var fig=document.createElement('figure'); fig.className='quote q-slide'+(on?' is-active':''); fig.setAttribute('aria-hidden',on?'false':'true');
      if(q.signal){
        var sg=document.createElement('p'); sg.className='q-signal';
        var sl=document.createElement('span'); sl.className='q-signal-label'; sl.textContent='Signal';
        sg.appendChild(sl); sg.appendChild(document.createTextNode(' '+q.signal)); fig.appendChild(sg);
      } else if(q.question){
        var pr=document.createElement('p'); pr.className='q-prompt';
        var pl=document.createElement('span'); pl.className='q-prompt-label'; pl.textContent='Asked';
        pr.appendChild(pl); pr.appendChild(document.createTextNode(' '+q.question)); fig.appendChild(pr);
      }
      var bq=document.createElement('blockquote'); bq.textContent='“'+(q.quote||'')+'”';
      var cap=document.createElement('figcaption');
      var segs=[];
      if(q.who) segs.push(q.who);
      if(q.month) segs.push(q.month);
      if(q.confidence&&q.confidence!=='unknown') segs.push(q.confidence+' confidence');
      if(q.topic){
        var ts=document.createElement('span'); ts.className='q-topic'; ts.textContent=q.topic; cap.appendChild(ts);
        if(segs.length) cap.appendChild(document.createTextNode(' · '+segs.join(' · ')));
      } else { cap.textContent=segs.join(' · '); }
      fig.appendChild(bq); fig.appendChild(cap); stage.appendChild(fig);
      var d=document.createElement('button'); d.type='button'; d.className='q-dot'+(on?' is-active':''); d.setAttribute('data-i',idx); d.setAttribute('aria-current',on?'true':'false'); d.setAttribute('aria-label','Show quote '+(idx+1)+' of '+pick.length); dotsWrap.appendChild(d);
    });
  }
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

// Drag-handle glyph (2×3 dots) for reordering sections. currentColor so it themes.
const GRIP_SVG = `<svg class="grip-i" viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/><circle cx="3" cy="8" r="1.2"/><circle cx="7" cy="8" r="1.2"/><circle cx="3" cy="13" r="1.2"/><circle cx="7" cy="13" r="1.2"/></svg>`;

// A collapsible, reorderable dashboard section: a drag grip + a toggle button that
// hides the body. `title` may contain trusted markup (it's a literal). `body` is
// prebuilt HTML. The grip drives drag/keyboard reordering (see sectionOrderScript).
function panel(key, title, desc, body) {
  const id = `panel-${esc(key)}`;
  return `<section class="panel" data-panel="${esc(key)}">
  <h2 class="panel-h"><button type="button" class="panel-grip" draggable="true" aria-label="Reorder this section — drag, or press Arrow Up / Arrow Down">${GRIP_SVG}</button><button type="button" class="panel-toggle" aria-expanded="true" aria-controls="${id}">${title}<svg class="panel-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button></h2>
  <div class="panel-body" id="${id}">${desc ? `<p class="desc">${desc}</p>` : ""}${body}</div>
</section>`;
}

// Reorder sections by dragging their grip (or focusing it and pressing Arrow Up/Down);
// the order persists to localStorage and is restored on load. Plain DnD API — no libs.
// Touch devices can't HTML5-drag, so the keyboard path is the accessible fallback.
function sectionOrderScript() {
  return `<script>(function(){
  var KEY="everpure-panel-order";
  var box=document.querySelector('[data-panels]'); if(!box) return;
  function panels(){return [].slice.call(box.querySelectorAll(':scope > .panel'));}
  function save(){try{localStorage.setItem(KEY,JSON.stringify(panels().map(function(p){return p.getAttribute('data-panel');})));}catch(e){}}
  // Restore saved order: known ids first (in saved order), any new panels keep their spot at the end.
  try{var saved=JSON.parse(localStorage.getItem(KEY)||'null');
    if(Array.isArray(saved)){var byId={};panels().forEach(function(p){byId[p.getAttribute('data-panel')]=p;});
      saved.forEach(function(id){if(byId[id])box.appendChild(byId[id]);});}}catch(e){}
  var dragging=null;
  function afterEl(y){ // first panel whose vertical midpoint sits below the cursor
    var best=null,bestOff=-Infinity;
    panels().forEach(function(p){if(p===dragging)return;var r=p.getBoundingClientRect();var off=y-r.top-r.height/2;if(off<0&&off>bestOff){bestOff=off;best=p;}});
    return best;
  }
  box.addEventListener('dragstart',function(e){
    var g=e.target.closest&&e.target.closest('.panel-grip'); if(!g)return;
    dragging=g.closest('.panel'); if(!dragging)return;
    dragging.classList.add('dragging');
    try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain','');}catch(_){}
  });
  box.addEventListener('dragover',function(e){
    if(!dragging)return; e.preventDefault();
    var ref=afterEl(e.clientY);
    if(ref){box.insertBefore(dragging,ref);}else{box.appendChild(dragging);}
  });
  box.addEventListener('drop',function(e){if(dragging)e.preventDefault();});
  box.addEventListener('dragend',function(){if(!dragging)return;dragging.classList.remove('dragging');dragging=null;save();});
  // Keyboard: focus a grip, Arrow Up/Down moves its section and persists.
  box.addEventListener('keydown',function(e){
    var g=e.target.closest&&e.target.closest('.panel-grip'); if(!g)return;
    if(e.key!=='ArrowUp'&&e.key!=='ArrowDown')return; e.preventDefault();
    var p=g.closest('.panel'); if(!p)return;
    if(e.key==='ArrowUp'&&p.previousElementSibling){box.insertBefore(p,p.previousElementSibling);}
    else if(e.key==='ArrowDown'&&p.nextElementSibling){box.insertBefore(p.nextElementSibling,p);}
    save(); g.focus();
  });
})();</script>`;
}

// Wire every section's header to collapse/expand its body; state persists per panel.
function panelScript() {
  return `<script>(function(){
  var KEY="everpure-panels", state={};
  try{state=JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch(e){}
  function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}}
  [].slice.call(document.querySelectorAll('.panel[data-panel]')).forEach(function(p){
    var key=p.getAttribute('data-panel'), btn=p.querySelector('.panel-toggle'), body=p.querySelector('.panel-body');
    if(!btn||!body) return;
    function set(open){btn.setAttribute('aria-expanded',open?'true':'false');body.hidden=!open;}
    if(state[key]===false) set(false);
    btn.addEventListener('click',function(){var open=btn.getAttribute('aria-expanded')!=='true';set(open);state[key]=open;save();});
  });
})();</script>`;
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
  <p class="sub">How the Everpure research program and its Helio UX signals move over time.${generated ? ` Built ${esc(generated)}.` : ""} <span class="hint">Drag a section’s ⠿ handle to reorder.</span></p>
</header>
<div class="kpis">${kpis}</div>

<div class="panels" data-panels>
${panel(
  "cycles",
  "Research program by cycle",
  "Concepts evaluated each 30-day cycle, by evidence-backed confidence. Findings and average evidence strength noted beneath each column.",
  confidenceChart(cycles)
)}

${panel(
  "helio",
  "Helio UX metrics",
  "Per-comparison UX scores (0–100) from the decks' Helio compare pages — baseline vs. the later variant. Higher is better. Each chart leads with its variant frontrunner and the signal we're reading from it.",
  helioSection(trends.helio_metrics || [], metricKeys, trends.ux_signals || [])
)}

${panel(
  "metrics",
  "Comprehension &amp; sentiment",
  "The two signals to watch — how each comparison moves from baseline to the latest variant (left), and across cycles as Helio history accrues (right).",
  metricTrendsSection(helioComparisons(trends.helio_metrics || []))
)}

${panel(
  "voice",
  "Voice of the user",
  trends.quote_mode === "curated"
    ? "The most telling verbatim for each pattern we surfaced across the research — what users actually understood, in their words."
    : "Verbatim respondent quotes — each labeled with the screen or comparison it’s about.",
  quotesSection(trends.quotes || [], trends.helio_metrics || [], trends.quote_mode)
)}

${panel(
  "issues",
  "Published issues",
  "Each monthly Research Roundup — open the frozen issue.",
  issuesSection(trends.issues || [])
)}
</div>

<footer>
  Source: committed <code>history/</code> + <code>issues/</code> + Helio compare evidence, rolled up by <code>build_trends.js</code>. Helio UX-metric trends begin June 2026 and grow as comparisons are run.
</footer>
${panelScript()}
${sectionOrderScript()}
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
  comparisonFrontrunner,
  matchUxSignal,
  frontrunnerBlock,
  metricTrends,
  metricTrendsSection,
  sparkline,
  succinctTitle,
};
