"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildTrends,
  helioRows,
  loadUxSignals,
  normConfidence,
  monthLabel,
  truncate,
} = require("../netlify/build_trends");
const {
  render,
  helioComparisons,
  comparisonFrontrunner,
  matchUxSignal,
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

test("buildTrends enriches the quote pool with harvested evidence verbatims", () => {
  const root = fixtureRepo();
  try {
    writeJson(path.join(root, "publish", "data", "external_research_evidence.json"), {
      evidence: [
        {
          evidence_text:
            'A participant said "I cannot find the pricing anywhere on this page." clearly.',
        },
      ],
    });
    const t = buildTrends(root);
    // The finding quote stays (deduped, not dropped) ...
    assert.ok(t.quotes.some((q) => /live sessions/.test(q.quote)));
    // ... and the evidence verbatim is harvested in, attributed generically.
    const harvested = t.quotes.find((q) => /pricing anywhere/.test(q.quote));
    assert.ok(harvested, "evidence verbatim harvested into the pool");
    assert.equal(harvested.title, "Research participant");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildTrends tags Helio verbatims with their compare_id", () => {
  const root = fixtureRepo();
  try {
    writeJson(path.join(root, "publish", "data", "helio_evidence.json"), {
      evidence: [
        {
          source_type: "helio_compare",
          compare_id: "cmpEvents",
          respondent_quotes: [
            "I assumed these sessions were recorded, not live.",
            "The schedule made sense to me once I scrolled.",
          ],
          respondent_quote_details: [
            {
              quote: "I assumed these sessions were recorded, not live.",
              question: "What did you expect from the events page?",
            },
            { quote: "The schedule made sense to me once I scrolled.", question: null },
          ],
        },
      ],
    });
    const t = buildTrends(root);
    const tagged = t.quotes.find((q) => /recorded, not live/.test(q.quote));
    assert.ok(tagged, "Helio verbatim harvested into the pool");
    assert.equal(tagged.compare_id, "cmpEvents");
    assert.equal(tagged.title, "Research participant");
    // The question prompt rides along (from the structured details).
    assert.equal(tagged.question, "What did you expect from the events page?");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildTrends features curated voice signals over the harvested pool when present", () => {
  const root = fixtureRepo();
  try {
    // A rich harvested pool exists...
    writeJson(path.join(root, "publish", "data", "helio_evidence.json"), {
      evidence: [
        {
          source_type: "helio_compare",
          compare_id: "cmpEvents",
          respondent_quotes: ["I assumed these sessions were recorded, not live."],
        },
      ],
    });
    // ...but a curated signal file takes precedence.
    writeJson(path.join(root, "netlify", "content", "voice_of_user.json"), {
      patterns: [
        {
          signal: "“Storage” is still the default read.",
          quote: "It's advertising cloud storage data for businesses.",
          topic: "EDC Success Blueprint",
        },
        { signal: "", quote: "dropped — no signal" }, // malformed → filtered out
      ],
    });
    const t = buildTrends(root);
    assert.equal(t.quote_mode, "curated");
    assert.equal(t.quotes.length, 1); // malformed entry filtered
    assert.equal(t.quotes[0].signal, "“Storage” is still the default read.");
    assert.equal(t.quotes[0].topic, "EDC Success Blueprint");
    assert.equal(t.quotes[0].title, "Research participant");
    // The harvested verbatim is NOT in the rotator pool (curated replaces it).
    assert.ok(!t.quotes.some((q) => /recorded, not live/.test(q.quote)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildTrends falls back to the harvested pool when no curation file", () => {
  const root = fixtureRepo();
  try {
    const t = buildTrends(root);
    assert.equal(t.quote_mode, "harvested");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- UX-metric signals + variant frontrunner ----------------------------

test("comparisonFrontrunner: variant beats baseline (lift, leads, biggest mover)", () => {
  const fr = comparisonFrontrunner([
    { test_name: "Baseline", metrics: { engagement: 50, comprehension: 60, overall_score: 55 } },
    { test_name: "V1", metrics: { engagement: 66, comprehension: 64, overall_score: 65 } },
  ]);
  assert.equal(fr.winnerName, "V1");
  assert.equal(fr.baselineName, "Baseline");
  assert.equal(fr.baselineWins, false);
  // Mean excludes the overall_score roll-up: base (50+60)/2=55, V1 (66+64)/2=65 → +10.
  assert.equal(fr.avgLift, 10);
  // leads/total DO count overall_score (both variants scored it; V1 tops all three).
  assert.equal(fr.leads, 3);
  assert.equal(fr.total, 3);
  assert.deepEqual(fr.biggest, { metric: "engagement", delta: 16 });
});

test("comparisonFrontrunner: detects regression (baseline still leads)", () => {
  const fr = comparisonFrontrunner([
    { test_name: "CTA Baseline", metrics: { success: 50, engagement: 10 } },
    { test_name: "CTA V1", metrics: { success: 12, engagement: 18 } },
    { test_name: "CTA V2", metrics: { success: 20, engagement: 4 } },
  ]);
  // Baseline mean 30 > V1 15 > V2 12 → the relabels regressed.
  assert.equal(fr.baselineWins, true);
  assert.equal(fr.baselineName, "CTA Baseline");
  assert.equal(fr.bestChallengerName, "CTA V1");
  assert.equal(fr.trailGap, 15);
});

test("comparisonFrontrunner: no head-to-head returns null", () => {
  assert.equal(comparisonFrontrunner([{ test_name: "Solo", metrics: { engagement: 50 } }]), null);
  assert.equal(comparisonFrontrunner([]), null);
  // A variant with no numeric metrics doesn't count toward the head-to-head.
  assert.equal(
    comparisonFrontrunner([
      { test_name: "A", metrics: { engagement: 50 } },
      { test_name: "B", metrics: {} },
    ]),
    null
  );
});

test("matchUxSignal: compare_id exact, title substring, title-only (no concept cross-match)", () => {
  const sigs = [
    { match: "EDC", signal: "edc read" },
    { match: "cmpABC", signal: "by id" },
  ];
  // Case-insensitive substring of the display title.
  assert.equal(matchUxSignal({ key: "k1", title: "EDC Blueprint vs v1" }, sigs).signal, "edc read");
  // Exact compare_id (key) match.
  assert.equal(matchUxSignal({ key: "cmpABC", title: "Whatever" }, sigs).signal, "by id");
  // Title-only: an inferred concept must NOT cross-match (title has no "edc").
  assert.equal(
    matchUxSignal({ key: "k2", title: "Book Filter Default", concept: "EDC" }, sigs),
    null
  );
  // No match → null.
  assert.equal(matchUxSignal({ key: "kX", title: "Pathfinder CTA Labels" }, sigs), null);
});

test("loadUxSignals filters malformed entries and trims/normalizes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uxsig-"));
  try {
    writeJson(path.join(root, "netlify", "content", "ux_signals.json"), {
      signals: [
        { match: "EDC", signal: "ok", read: "win", recommendation: "ship it" },
        { match: "  X  ", signal: "  trimmed  " },
        { match: "", signal: "no match key" }, // dropped
        { signal: "no match field" }, // dropped
        { match: "Y" }, // no signal → dropped
      ],
    });
    const out = loadUxSignals(root);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], {
      match: "EDC",
      signal: "ok",
      read: "win",
      recommendation: "ship it",
    });
    // Trimmed; absent read/recommendation aren't added as empty keys.
    assert.deepEqual(out[1], { match: "X", signal: "trimmed" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  // Absent file → empty list.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "uxsig-"));
  try {
    assert.deepEqual(loadUxSignals(empty), []);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test("buildTrends emits curated ux_signals (empty when no file)", () => {
  let root = fixtureRepo();
  try {
    assert.deepEqual(buildTrends(root).ux_signals, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  root = fixtureRepo();
  try {
    writeJson(path.join(root, "netlify", "content", "ux_signals.json"), {
      signals: [{ match: "EDC", signal: "edc read", read: "win" }],
    });
    const t = buildTrends(root);
    assert.equal(t.ux_signals.length, 1);
    assert.equal(t.ux_signals[0].match, "EDC");
    assert.equal(t.ux_signals[0].signal, "edc read");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("render: frontrunner + curated signal beneath each chart; computed fallback when uncurated", () => {
  const mk = (compare_id, comparison_title, test_id, test_name, metrics) => ({
    month: "2026-06",
    compare_id,
    source_url: null,
    comparison_title,
    derived_title: null,
    concept: null,
    link_text: null,
    test_id,
    test_name,
    thumbnail: null,
    n: 100,
    metrics,
  });
  const helio_metrics = [
    mk("cmpEDC", "EDC Baseline vs v1", "b", "Baseline", { engagement: 50, sentiment: 26 }),
    mk("cmpEDC", "EDC Baseline vs v1", "v", "V1", { engagement: 66, sentiment: 44 }),
    mk("cmpUNC", "Foo vs Bar", "f", "Foo", { engagement: 40, sentiment: 30 }),
    mk("cmpUNC", "Foo vs Bar", "r", "Bar", { engagement: 55, sentiment: 45 }),
    mk("cmpSOLO", "Accelerate Overview", "s", "Accelerate Overview", {
      comprehension: 72,
      sentiment: 19,
    }),
  ];
  const html = render({
    cycles: [],
    concepts: [],
    metric_keys: ["engagement", "comprehension", "sentiment"],
    helio_metrics,
    quotes: [],
    quote_mode: "harvested",
    ux_signals: [
      { match: "EDC", signal: "V1 lifts every metric.", read: "win", recommendation: "Ship V1." },
      { match: "Accelerate", signal: "Single screen: grasped but not loved.", read: "mixed" },
    ],
  });
  // Curated signal + recommendation render inside the card.
  assert.match(html, /<span class="cmp-signal-label">Signal<\/span> V1 lifts every metric\./);
  assert.match(html, /<span class="cmp-rec-label">Next<\/span> Ship V1\./);
  // Deterministic frontrunner line names the winning variant.
  assert.match(
    html,
    /<span class="cmp-front-label">Frontrunner<\/span> <span class="cf-name">V1<\/span>/
  );
  // The uncurated comparison falls back to a COMPUTED signal (no curated entry for it).
  assert.match(html, /Bar leads \d of \d metrics/);
  // The single-variant screen shows the "Single screen" note + its curated signal.
  assert.match(html, /<span class="cmp-front-label">Single screen<\/span>/);
  assert.match(html, /grasped but not loved/);
  // The frontrunner/signal block lives INSIDE the .cmp card (hides with the filter).
  assert.match(html, /<div class="mc"[\s\S]*?<div class="cmp-foot">/);
});

test("render shows the curated signal eyebrow and rotates the full curated set", () => {
  const quotes = [
    {
      month: "2026-06",
      title: "Research participant",
      quote: "It's advertising cloud storage data for businesses.",
      confidence: "unknown",
      topic: "EDC Success Blueprint",
      signal: "“Storage” is still the default read.",
    },
    {
      month: "2026-06",
      title: "Research participant",
      quote: "I am not sure, because my eyes went to the man that was standing there.",
      confidence: "unknown",
      topic: "Accelerate Overview Page",
      signal: "The hero person out-competes the message.",
    },
  ];
  const html = render({
    cycles: [],
    concepts: [],
    metric_keys: [],
    helio_metrics: [],
    quotes,
    quote_mode: "curated",
  });
  // SSR renders the signal eyebrow (not the "Asked" prompt) for a curated quote.
  assert.match(html, /<p class="q-signal"><span class="q-signal-label">Signal<\/span>/);
  assert.match(html, /Storage.{0,4} is still the default read/);
  // Pool carries the signal + topic for the client rotator.
  const pool = JSON.parse(html.match(/data-quotes>(.*?)<\/script>/s)[1].replace(/\\u003c/g, "<"));
  assert.equal(pool.length, 2);
  assert.ok(pool.every((p) => p.signal && p.topic));
  // Curated mode rotates every signal (MAX === pool length), not a fixed 5.
  assert.match(html, /var MAX=2;/);
});

test("render labels Voice-of-user quotes with the comparison/finding topic", () => {
  const html = render({
    cycles: [],
    concepts: [],
    metric_keys: [],
    helio_metrics: [
      {
        compare_id: "cmpEDC",
        test_id: "rA",
        test_name: "Baseline",
        comparison_title: "191 EDC Success Blueprint Baseline vs 191 EDC Page V1",
        derived_title: "Edc Success Blueprint vs Edc Page",
        concept: "Pathfinder CTA Labels", // untrusted — must not win the label
        metrics: { comprehension: 72, sentiment: 26 },
      },
    ],
    quotes: [
      {
        month: "2026-06",
        title: "Research participant",
        quote: "I couldn't tell what this page was for.",
        confidence: "unknown",
        compare_id: "cmpEDC",
        question: "In your own words, what is this page about?",
      },
      {
        month: "2026-05",
        title: "Events Page",
        quote: "It finally clicked once I saw the diagram.",
        confidence: "high",
      },
      {
        month: "2026-06",
        title: "Research participant",
        quote: "The pricing was impossible to find anywhere.",
        confidence: "unknown",
      },
    ],
  });
  // The embedded pool carries a resolved topic so the rotator can label each quote.
  const pool = JSON.parse(html.match(/data-quotes>(.*?)<\/script>/s)[1].replace(/\\u003c/g, "<"));
  const helioQ = pool.find((p) => /what this page was for/.test(p.quote));
  // Topic comes from the compare page title (succinct), NOT the wrong inferred concept.
  assert.match(helioQ.topic, /EDC Success Blueprint/);
  assert.ok(!/Pathfinder/.test(helioQ.topic));
  assert.equal(helioQ.who, "Research participant");
  // The question the participant answered rides along, for the prompt line.
  assert.equal(helioQ.question, "In your own words, what is this page about?");
  // A curated finding quote uses its finding title as the topic.
  const findingQ = pool.find((p) => /finally clicked/.test(p.quote));
  assert.equal(findingQ.topic, "Events Page");
  assert.equal(findingQ.who, null);
  assert.equal(findingQ.question, null);
  // A generic deck open-end has no single topic.
  const deckQ = pool.find((p) => /pricing was impossible/.test(p.quote));
  assert.equal(deckQ.topic, null);
  assert.equal(deckQ.who, "Research participant");
  // The SSR figcaption renders the topic in a styled span.
  assert.match(html, /<span class="q-topic">/);
  // …and the question prompt renders above the quote.
  assert.match(html, /<p class="q-prompt"><span class="q-prompt-label">Asked<\/span>/);
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

    // Charts are responsive HTML/CSS (not scaled SVG), so labels stay legible on
    // mobile: the confidence chart is HTML columns and comparisons are HTML bars.
    assert.match(html, /class="ccols"/);
    assert.match(html, /class="mc-metric"/);
    assert.ok(!/<svg class="chart"/.test(html), "charts no longer use the scaled SVG canvas");

    // Sections are collapsible: each is a labeled panel with a toggle + body, and a
    // single wiring script persists the open/closed state.
    assert.match(html, /class="panel" data-panel="helio"/);
    assert.match(
      html,
      /class="panel-toggle"[^>]*aria-expanded="true"[^>]*aria-controls="panel-helio"/
    );
    assert.match(html, /class="panel-body" id="panel-helio"/);
    assert.match(html, /everpure-panels/);
    assert.equal((html.match(/class="panel" data-panel=/g) || []).length, 5);

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

test("render embeds the full quote pool and shuffles up to 5 in on load", () => {
  const q = (n, month) => ({ month, title: `T${n}`, quote: `quote ${n}`, confidence: "high" });
  const quotes = [];
  for (let n = 1; n <= 8; n++) quotes.push(q(n, "2026-06"));
  const html = render({
    cycles: [],
    concepts: [],
    helio_metrics: [],
    metric_keys: [],
    issues: [],
    quotes,
  });
  // Rotator present with a single SSR fallback slide (the rest are built on load).
  assert.match(html, /class="qrotator" data-qrotator/);
  assert.equal((html.match(/class="quote q-slide/g) || []).length, 1);
  // The WHOLE pool is embedded (not just 5) — selection happens client-side.
  assert.match(html, /<script type="application\/json" data-quotes>/);
  assert.match(html, /quote 1\b/); // oldest is in the pool, available to rotate in
  assert.match(html, /quote 8\b/);
  // The script shuffles (Math.random) and picks up to MAX=5, building slides + dots.
  assert.match(html, /var MAX=5/);
  assert.match(html, /Math\.random/);
  assert.match(html, /slice\(0, ?MAX\)/);
  assert.match(html, /createElement\("figure"\)|createElement\('figure'\)/);
  // a11y + motion preserved in the rotation logic.
  assert.match(html, /prefers-reduced-motion/);
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
