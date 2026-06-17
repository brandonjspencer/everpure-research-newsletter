"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildTrends, helioRows, normConfidence } = require("../netlify/build_trends");
const { render } = require("../netlify/render_trends_dashboard");

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
  // A frozen issue with a finding count + a respondent quote.
  writeJson(path.join(root, "issues", "2026-05", "default.json"), {
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
        comparison_title: "Events Baseline vs V1",
        inferred_concepts: ["Events Page"],
        variants: [
          { take_id: "T1", report_id: "R1", name: "Baseline" },
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
        inferred_concepts: ["C"],
        variants: [{ take_id: "T1", report_id: "R1", name: "Base" }],
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

    // Respondent quote captured from the frozen issue.
    assert.equal(t.quotes.length, 1);
    assert.match(t.quotes[0].quote, /live sessions/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("render produces a self-contained dashboard with all sections + charts", () => {
  const root = fixtureRepo();
  try {
    const trends = { generated_at: "2026-06-17T00:00:00Z", ...buildTrends(root) };
    const html = render(trends);

    // Self-contained: no external chart lib, balanced SVG tags.
    assert.match(html, /<!doctype html>/i);
    assert.equal((html.match(/<svg/g) || []).length, (html.match(/<\/svg>/g) || []).length);

    // All three sections present.
    for (const heading of ["Research program by cycle", "Helio UX metrics", "Voice of the user"]) {
      assert.ok(html.includes(heading), `missing section: ${heading}`);
    }
    // Helio comparison rendered with sample size + a metric value.
    assert.match(html, /Events Baseline vs V1/);
    assert.match(html, /n=100/);
    // Quote carried through.
    assert.match(html, /live sessions/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("render shows a friendly empty state when no Helio data exists", () => {
  const html = render({ cycles: [], concepts: [], helio_metrics: [], quotes: [], metric_keys: [] });
  assert.match(html, /No Helio comparisons captured yet/);
});
