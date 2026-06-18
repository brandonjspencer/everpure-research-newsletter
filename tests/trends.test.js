"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildTrends,
  helioRows,
  normConfidence,
  monthLabel,
  truncate,
} = require("../netlify/build_trends");
const {
  render,
  helioComparisons,
  sparkline,
  succinctTitle,
} = require("../netlify/render_trends_dashboard");

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data), "utf8");
}

function conceptCycle(month, concepts) {
  return {
    generated_at: month,
    concept_count: concepts.length,
    with_evidence_count: concepts.length,
    concepts,
  };
}

function fixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trends-"));
  writeJson(
    path.join(root, "history", "concept_evidence", "2026-04.json"),
    conceptCycle("2026-04", [
      {
        concept_key: "events",
        concept_display: "Events Page",
        matched_confidence: "moderate",
        matched_decision_status: "watch",
        evidence_strength_score: 20,
        weeks_seen: ["2026-04-02", "2026-04-09"],
      },
    ])
  );
  writeJson(
    path.join(root, "history", "concept_evidence", "2026-05.json"),
    conceptCycle("2026-05", [
      {
        concept_key: "events",
        concept_display: "Events Page",
        matched_confidence: "High confidence",
        matched_decision_status: "iterate",
        evidence_strength_score: 30,
        weeks_seen: ["2026-05-07"],
      },
    ])
  );
  // An earlier issue with NO explicit issue number — exercises the chronological
  // fallback (oldest = Issue 01).
  writeJson(path.join(root, "issues", "2026-04", "default.json"), {
    title: "Everpure monthly research roundup (30d)",
    executive_summary: "April set three direction calls.",
    surfaced_findings: [],
    comparison_tests: [],
  });
  // A frozen issue with a finding count, a respondent quote, issue metadata,
  // and the prose executive summary used by the hero card.
  writeJson(path.join(root, "issues", "2026-05", "default.json"), {
    title: "Everpure monthly research roundup (30d)",
    issue: { number: "02", label: "Issue 02", date: "May 2026" },
    summary: { week_count_30d: 4 },
    executive_summary: "May focused on the events page and EDC live sessions.",
    surfaced_findings: [
      {
        title: "Events Page",
        confidence: "High confidence",
        decision_status: "iterate",
        respondent_quote: "I couldn't tell these were live sessions.",
      },
    ],
    comparison_tests: [{ title: "EDC" }],
  });
  // Helio metrics for the cycle (committed history).
  writeJson(path.join(root, "history", "helio", "2026-05.json"), {
    evidence: [
      {
        source_type: "helio_compare",
        compare_id: "cmpEvents",
        source_url: "https://glare-playground.helio.app/share/compare/cmpEvents",
        comparison_title: "Events Baseline vs V1",
        inferred_concepts: ["Events Page"],
        variants: [
          {
            take_id: "T1",
            report_id: "R1",
            name: "Baseline",
            thumbnail:
              "https://assets.helio.app/asset/AAA/medium_baseline.png?Expires=1&Signature=x",
          },
          { take_id: "T2", report_id: "R2", name: "V1" },
        ],
        metrics: [
          {
            label: "Engagement",
            values: [
              { take_id: "T1", score: 52 },
              { take_id: "T2", score: 68 },
            ],
          },
          {
            label: "Sentiment",
            values: [
              { take_id: "T1", score: 26 },
              { take_id: "T2", score: 44 },
            ],
          },
        ],
        report_configs: [
          { report_id: "R1", responses_count: 100 },
          { report_id: "R2", responses_count: 98 },
        ],
      },
    ],
  });
  return root;
}

test("normConfidence maps Helio + issue confidence vocab to a common scale", () => {
  assert.equal(normConfidence("moderate"), "medium");
  assert.equal(normConfidence("High confidence"), "high");
  assert.equal(normConfidence("Low confidence"), "low");
  assert.equal(normConfidence(""), "unknown");
});

test("helioRows flattens one row per variant with metrics + n", () => {
  const payload = {
    evidence: [
      {
        source_type: "helio_compare",
        comparison_title: "X vs Y",
        source_url: "https://glare-playground.helio.app/share/compare/cmpXY",
        inferred_concepts: ["C"],
        variants: [
          {
            take_id: "T1",
            report_id: "R1",
            name: "Base",
            thumbnail: "https://assets.helio.app/asset/AAA/medium_base.png?Expires=1&Signature=x",
          },
        ],
        metrics: [{ label: "Overall UX", values: [{ take_id: "T1", score: 56 }] }],
        report_configs: [{ report_id: "R1", responses_count: 100 }],
      },
    ],
  };
  const rows = helioRows(payload, "2026-05");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].metrics.overall_ux, 56);
  assert.equal(rows[0].n, 100);
  assert.equal(rows[0].month, "2026-05");
  // The compare share page URL is carried through for the dashboard link.
  assert.equal(rows[0].source_url, "https://glare-playground.helio.app/share/compare/cmpXY");
  // The per-variant screenshot thumbnail rides along for the legend tooltip.
  assert.match(rows[0].thumbnail, /assets\.helio\.app\/asset\/AAA\/medium_base\.png/);
});

test("buildTrends rolls up cycles, trajectories, helio metrics, and quotes", () => {
  const root = fixtureRepo();
  try {
    const t = buildTrends(root);

    // Two research cycles, ordered, with normalized breakdowns + finding count.
    assert.deepEqual(
      t.cycles.map((c) => c.month),
      ["2026-04", "2026-05"]
    );
    assert.equal(t.cycles[1].confidence_breakdown.high, 1);
    assert.equal(t.cycles[1].decision_breakdown.iterate, 1);
    assert.equal(t.cycles[1].finding_count, 2); // 1 surfaced + 1 comparison

    // Per-concept trajectory across both cycles.
    const events = t.concepts.find((c) => c.display === "Events Page");
    assert.equal(events.points.length, 2);
    assert.deepEqual(
      events.points.map((p) => p.confidence),
      ["medium", "high"]
    );

    // Helio metric rows (2 variants), with month from the history filename.
    const helio = t.helio_metrics.filter((r) => r.month === "2026-05");
    assert.equal(helio.length, 2);
    assert.equal(helio[0].metrics.engagement, 52);
    assert.equal(helio[0].source_url, "https://glare-playground.helio.app/share/compare/cmpEvents");

    // Respondent quote captured from the frozen issue.
    assert.equal(t.quotes.length, 1);
    assert.match(t.quotes[0].quote, /live sessions/);

    // Issue hero data: human label, issue tag, prose summary (not the stats
    // object), finding count, and the frozen-issue href.
    const may = t.issues.find((i) => i.month === "2026-05");
    assert.equal(may.label, "May 2026");
    assert.equal(may.issue_label, "Issue 02");
    // Chronological fallback: April has no explicit issue number → Issue 01.
    const apr = t.issues.find((i) => i.month === "2026-04");
    assert.equal(apr.issue_label, "Issue 01");
    assert.equal(may.finding_count, 2);
    assert.match(may.summary, /events page/i);
    assert.equal(may.href, "issues/2026-05/default.html");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("monthLabel and truncate format issue-card text", () => {
  assert.equal(monthLabel("2026-06"), "June 2026");
  assert.equal(monthLabel("2026-01"), "January 2026");
  assert.equal(monthLabel("nope"), "nope");
  assert.equal(truncate("short", 50), "short");
  const long = truncate("a ".repeat(200), 50);
  assert.ok(long.length <= 52 && long.endsWith("…"));
});

test("render produces a self-contained dashboard with all sections + charts", () => {
  const root = fixtureRepo();
  try {
    const trends = { generated_at: "2026-06-17T00:00:00Z", ...buildTrends(root) };
    const html = render(trends);

    // Self-contained: no external chart lib, balanced SVG tags.
    assert.match(html, /<!doctype html>/i);
    assert.equal((html.match(/<svg/g) || []).length, (html.match(/<\/svg>/g) || []).length);

    // All sections present, including the issue hero cards.
    for (const heading of [
      "Research program by cycle",
      "Helio UX metrics",
      "Voice of the user",
      "Published issues",
    ]) {
      assert.ok(html.includes(heading), `missing section: ${heading}`);
    }
    // Helio comparison rendered with the succinct title + sample size.
    assert.match(html, /Events Baseline vs v1/);
    assert.match(html, /n=100/);
    // Comparisons are a dropdown multiselect (collapsed by default) ...
    assert.match(html, /class="ms" data-ms="helio"/);
    assert.match(html, /class="ms-toggle"[^>]*aria-expanded="false"/);
    // ... and each comparison links out to its Helio compare page.
    assert.match(
      html,
      /class="cmp-link"[^>]*href="https:\/\/glare-playground\.helio\.app\/share\/compare\/cmpEvents"/
    );
    assert.match(html, />View in Helio/);
    // A variant with a screenshot gets a hover thumbnail in the legend; the one
    // without a thumbnail stays a plain legend item (no broken src="null").
    assert.equal((html.match(/class="lg has-thumb"/g) || []).length, 1);
    assert.ok(!/src="null"/.test(html), "missing-thumbnail variant must not render src=null");
    assert.match(
      html,
      /class="thumb-pop"><img src="https:\/\/assets\.helio\.app\/asset\/AAA\/medium_baseline\.png/
    );
    // A broken/expired signed URL collapses the affordance (onerror fallback).
    assert.match(html, /onerror="[^"]*remove\(\)/);
    // Comprehension & sentiment panel: sentiment shows the baseline→variant delta;
    // with only one cycle, the over-time trend is flagged as accruing.
    assert.match(html, /Comprehension &amp; sentiment/);
    assert.match(html, /class="mt-row"/);
    assert.match(html, /26 → 44/);
    assert.match(html, /\+18/);
    assert.match(html, /accrues monthly/);
    // Quote carried through, inside the cross-fading rotator.
    assert.match(html, /live sessions/);
    assert.match(html, /class="qrotator"/);
    // Issue hero card: branded card linking to the frozen issue.
    assert.match(html, /class="issue-hero"/);
    assert.match(html, /href="issues\/2026-05\/default\.html"/);
    assert.match(html, /May 2026/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("render features the newest quotes as a capped cross-fading rotator", () => {
  const q = (n, month) => ({ month, title: `T${n}`, quote: `quote ${n}`, confidence: "high" });
  const html = render({
    cycles: [],
    concepts: [],
    helio_metrics: [],
    metric_keys: [],
    issues: [],
    // Oldest-first, as build_trends emits them (6 quotes, cap is 5).
    quotes: [
      q(1, "2026-01"),
      q(2, "2026-02"),
      q(3, "2026-03"),
      q(4, "2026-04"),
      q(5, "2026-05"),
      q(6, "2026-06"),
    ],
  });
  // Rotator present, capped to the 5 newest, exactly one active to start.
  assert.match(html, /class="qrotator" data-qrotator/);
  assert.equal((html.match(/class="quote q-slide/g) || []).length, 5);
  assert.equal((html.match(/class="quote q-slide is-active"/g) || []).length, 1);
  // One dot per slide ([ "] avoids matching the "q-dots" container).
  assert.equal((html.match(/class="q-dot[ "]/g) || []).length, 5);
  // Newest five quotes shown; the oldest (quote 1) is dropped by the cap.
  // (Match the blockquote body, not bare "quote 1", which also appears in a dot
  // aria-label like "Show quote 1 of 5".)
  assert.match(html, /&ldquo;quote 6&rdquo;/);
  assert.ok(!/&ldquo;quote 1&rdquo;/.test(html), "oldest quote dropped by the rotator cap");
  // The auto-advance script honors reduced motion.
  assert.match(html, /prefers-reduced-motion/);
  // a11y: only the active slide is in the accessibility tree, and the active dot
  // carries a programmatic "current" state (not color-only).
  assert.equal((html.match(/q-slide is-active" aria-hidden="false"/g) || []).length, 1);
  // The four inactive slides are hidden from AT (scope to slides — the sidebar
  // icons and caret also carry aria-hidden="true").
  assert.equal((html.match(/quote q-slide" aria-hidden="true"/g) || []).length, 4);
  assert.equal(
    (html.match(/class="q-dot is-active" data-i="0" aria-current="true"/g) || []).length,
    1
  );
  // The script keeps both in sync (aria-hidden + aria-current toggled in show()).
  assert.match(html, /setAttribute\('aria-hidden'/);
  assert.match(html, /setAttribute\('aria-current'/);
});

test("comparison links gate out non-http(s) schemes (no javascript: href)", () => {
  const row = (source_url) => ({
    month: "2026-06",
    compare_id: "cmpEvil",
    source_url,
    comparison_title: null,
    concept: "Events Page",
    test_id: "t1",
    test_name: "Baseline",
    n: 100,
    metrics: { engagement: 60 },
  });
  // A malicious deck hyperlink target should never become a clickable link.
  const evil = render({
    cycles: [],
    concepts: [],
    issues: [],
    quotes: [],
    metric_keys: ["engagement"],
    helio_metrics: [row("javascript:alert(document.cookie)")],
  });
  assert.ok(!/href="javascript:/i.test(evil), "javascript: scheme must not reach an href");
  assert.ok(!/javascript:alert/.test(evil), "malicious payload must not appear in output");
  // The comparison itself still renders (just without an outbound link).
  assert.match(evil, /Events Page/);
  assert.ok(!/class="cmp-link"/.test(evil) && !/class="ms-opt-link"/.test(evil));
  // A normal https compare URL still produces both links.
  const ok = render({
    cycles: [],
    concepts: [],
    issues: [],
    quotes: [],
    metric_keys: ["engagement"],
    helio_metrics: [row("https://glare-playground.helio.app/share/compare/cmpOK")],
  });
  assert.match(
    ok,
    /class="cmp-link" href="https:\/\/glare-playground\.helio\.app\/share\/compare\/cmpOK"/
  );
  assert.match(
    ok,
    /class="ms-opt-link" href="https:\/\/glare-playground\.helio\.app\/share\/compare\/cmpOK"/
  );
});

test("helioComparisons keeps the newest cycle's row per variant (fresh thumbnail wins)", () => {
  // Same comparison + variant seen in two cycles (oldest first, as build_trends emits).
  const base = {
    compare_id: "cmpX",
    comparison_title: "X vs Y",
    concept: "C",
    test_id: "t1",
    test_name: "Base",
    n: 100,
  };
  const cmps = helioComparisons([
    {
      ...base,
      month: "2026-05",
      thumbnail: "https://assets.helio.app/asset/OLD/m.png?Expires=1",
      metrics: { engagement: 50 },
    },
    {
      ...base,
      month: "2026-07",
      thumbnail: "https://assets.helio.app/asset/NEW/m.png?Expires=9",
      metrics: { engagement: 55 },
    },
  ]);
  assert.equal(cmps.length, 1);
  assert.equal(cmps[0].variants.length, 1);
  // Freshest cycle wins — its (newly-signed) thumbnail and re-measured metrics.
  assert.match(cmps[0].variants[0].thumbnail, /asset\/NEW\//);
  assert.equal(cmps[0].variants[0].metrics.engagement, 55);
});

test("helioComparisons builds comprehension/sentiment trends (variants now, cycles over time)", () => {
  const mk = (month, test_id, name, comprehension, sentiment) => ({
    month,
    compare_id: "cmpA",
    source_url: "https://glare-playground.helio.app/share/compare/cmpA",
    comparison_title: "EDC Baseline vs v1",
    concept: "EDC",
    test_id,
    test_name: name,
    n: 100,
    metrics: { comprehension, sentiment },
  });
  // One comparison, two variants, measured across two cycles (oldest first).
  const cmps = helioComparisons([
    mk("2026-05", "rB", "Baseline", 70, 30),
    mk("2026-05", "rV", "V1", 74, 44),
    mk("2026-06", "rB", "Baseline", 72, 33),
    mk("2026-06", "rV", "V1", 78, 50),
  ]);
  assert.equal(cmps.length, 1);
  const t = cmps[0].trends;
  // Across variants = the latest cycle (2026-06), baseline → v1.
  assert.deepEqual(t.comprehension.variants, [72, 78]);
  assert.deepEqual(t.sentiment.variants, [33, 50]);
  // Over cycles = best (max) per month — fills in as history accrues.
  assert.deepEqual(
    t.comprehension.cycles.map((p) => p.value),
    [74, 78]
  );
  assert.deepEqual(
    t.sentiment.cycles.map((p) => p.value),
    [44, 50]
  );
});

test("helioComparisons relabels a comparison whose page contradicts the inferred concept", () => {
  const r = (compare_id, concept, derived_title, test_id, name) => ({
    month: "2026-06",
    compare_id,
    source_url: `https://glare-playground.helio.app/share/compare/${compare_id}`,
    comparison_title: null,
    derived_title,
    concept,
    test_id,
    test_name: name,
    n: 73,
    metrics: { sentiment: 40 },
  });
  const cmps = helioComparisons([
    // Knowledge-Portal page mis-inferred as "EDC Success Blueprint": the page-derived
    // title shares no word with the concept → distrust it, label from the page.
    r(
      "kp",
      "EDC Success Blueprint",
      "VMware Platform Guides vs Book Filter Default",
      "k1",
      "VMware Platform Guides"
    ),
    r(
      "kp",
      "EDC Success Blueprint",
      "VMware Platform Guides vs Book Filter Default",
      "k2",
      "Book Filter Default"
    ),
    // Two Pathfinder pages whose derived titles corroborate the concept → still collapse.
    r("p1", "Pathfinder CTA Labels", "Pathfinder CTA v0 vs Pathfinder CTA v1", "a", "v0"),
    r("p2", "Pathfinder CTA Labels", "Pathfinder CTA v0 vs Pathfinder CTA v2", "b", "v2"),
  ]);
  assert.deepEqual(cmps.map((c) => c.title).sort(), [
    "Pathfinder CTA Labels",
    "VMware Platform Guides vs Book Filter Default",
  ]);
  assert.ok(
    !cmps.some((c) => /EDC Success Blueprint/.test(c.title)),
    "the wrong slide-inferred concept label is not shown"
  );
});

test("sparkline renders a dot for one point and a polyline for many", () => {
  const one = sparkline([50]);
  assert.match(one, /<circle/);
  assert.ok(!/polyline/.test(one), "single point is a dot, not a line");
  const many = sparkline([20, 60, 80]);
  assert.match(many, /<polyline points="[^"]+"/);
  assert.match(many, /<circle/); // endpoint marker
  assert.equal(sparkline([]), ""); // nothing to draw
});

test("render shows a friendly empty state when no Helio data exists", () => {
  const html = render({ cycles: [], concepts: [], helio_metrics: [], quotes: [], metric_keys: [] });
  assert.match(html, /No Helio comparisons captured yet/);
});

test("helioComparisons: titled stays distinct, concept dups collapse, unlabeled dropped", () => {
  const v = (compare_id, concept, test_id, test_name, metric, comparison_title) => ({
    compare_id,
    comparison_title: comparison_title || null,
    concept,
    source_url: `https://glare-playground.helio.app/share/compare/${compare_id}`,
    test_id,
    test_name,
    n: 100,
    metrics: { [metric]: 60 },
  });
  const edcTitle = "191 EDC Success Blueprint Baseline vs 191 EDC Page V1";
  const rows = [
    // EDC has a real comparison_title → its own block (succinct), despite its
    // concept also being Pathfinder.
    v("edc", "Pathfinder CTA Labels", "e1", "Baseline", "engagement", edcTitle),
    v("edc", "Pathfinder CTA Labels", "e2", "Page V1", "engagement", edcTitle),
    // Two concept-only Pathfinder pages → collapse to ONE block (keep the richer).
    v("p1", "Pathfinder CTA Labels", "a", "Variant 1", "engagement"),
    v("p2", "Pathfinder CTA Labels", "b", "Variant 1", "engagement"),
    v("p2", "Pathfinder CTA Labels", "c", "Variant 2", "engagement"),
    // No concept and no title → dropped entirely (the confusing "Data Comparison").
    v("x", null, "01ULIDONLYXXXXXXXXXXXXXXXX", "Variant 1", "sentiment"),
  ];
  const cmps = helioComparisons(rows);
  assert.deepEqual(cmps.map((c) => c.title).sort(), [
    "EDC Success Blueprint Baseline vs v1",
    "Pathfinder CTA Labels",
  ]);
  assert.equal(cmps.length, 2); // unlabeled dropped
  const pf = cmps.find((c) => c.title === "Pathfinder CTA Labels");
  assert.equal(pf.variants.length, 2); // collapsed to the richer page (p2)
  assert.ok(!cmps.some((c) => /01ULID/.test(JSON.stringify(c))), "unlabeled comparison dropped");
  // The Helio compare page URL is carried onto each comparison for the dashboard link.
  const edc = cmps.find((c) => c.title === "EDC Success Blueprint Baseline vs v1");
  assert.equal(edc.url, "https://glare-playground.helio.app/share/compare/edc");
  assert.ok(pf.url && /share\/compare\//.test(pf.url));
});

test("succinctTitle drops number prefixes and collapses the trailing version", () => {
  assert.equal(
    succinctTitle("191 EDC Success Blueprint Baseline vs 191 EDC Page V1"),
    "EDC Success Blueprint Baseline vs v1"
  );
  assert.equal(succinctTitle("Pathfinder CTA Labels"), "Pathfinder CTA Labels");
});
