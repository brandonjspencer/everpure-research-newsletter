#!/usr/bin/env node
/**
 * Aggregate the committed longitudinal record into a single dashboard dataset.
 *
 * "Database" here is the repo itself: each cycle's evidence is frozen into
 * history/ + issues/ (immutable, git-diffable, auditable — same ethos as the
 * rest of the builder). This rolls those up — plus the current build's Helio
 * metrics — into publish/data/trends.json, the denormalized feed the static
 * trends dashboard reads. No server, no DB engine.
 *
 * Sources:
 *   history/concept_evidence/YYYY-MM.json  → per-cycle research outcomes
 *                                            (confidence, decision, strength)
 *   issues/YYYY-MM/default.json            → finding counts + respondent quotes
 *   history/helio/YYYY-MM.json (+ current  → Helio UX-metric time series
 *     publish/data/helio_evidence.json)
 *
 * Run: node netlify/build_trends.js <repo-root>
 */
const fs = require("fs");
const path = require("path");

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function monthlyFiles(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
      .sort();
  } catch {
    return [];
  }
}

function monthDirs(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((m) => /^\d{4}-\d{2}$/.test(m))
      .sort();
  } catch {
    return [];
  }
}

function normConfidence(value) {
  const t = String(value || "").toLowerCase();
  if (/high/.test(t)) return "high";
  if (/mod|med/.test(t)) return "medium";
  if (/low/.test(t)) return "low";
  return "unknown";
}

function normDecision(value) {
  return (
    String(value || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_") || "unknown"
  );
}

function metricKey(label) {
  return String(label || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
  if (!m) return String(ym || "");
  return `${MONTH_NAMES[parseInt(m[2], 10) - 1] || m[2]} ${m[1]}`;
}

function truncate(text, limit = 180) {
  const t = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:]$/, "") + "…";
}

// Flatten a helio_evidence payload into one row per variant per comparison.
function helioRows(payload, month) {
  const out = [];
  const evidence = (payload && payload.evidence) || [];
  for (const rec of evidence) {
    if (rec.source_type !== "helio_compare") continue;
    const byVariant = {};
    for (const v of rec.variants || []) {
      byVariant[v.take_id] = {
        test_id: v.report_id || null,
        test_name: v.name || null,
        thumbnail: v.thumbnail || null,
        metrics: {},
      };
    }
    for (const metric of rec.metrics || []) {
      const key = metricKey(metric.label);
      for (const v of metric.values || []) {
        const slot = (byVariant[v.take_id] = byVariant[v.take_id] || {
          test_name: v.name || null,
          metrics: {},
        });
        if (typeof v.score === "number") slot.metrics[key] = v.score;
      }
    }
    const ns = (rec.report_configs || [])
      .map((c) => c.responses_count)
      .filter((n) => typeof n === "number");
    const n = ns.length ? Math.max(...ns) : null;
    for (const slot of Object.values(byVariant)) {
      if (!Object.keys(slot.metrics).length) continue;
      out.push({
        month,
        compare_id: rec.compare_id || null,
        source_url: rec.source_url || null,
        comparison_title: rec.comparison_title || null,
        concept: (rec.inferred_concepts || [])[0] || null,
        link_text: rec.link_text || null,
        test_id: slot.test_id || null,
        test_name: slot.test_name || null,
        thumbnail: slot.thumbnail || null,
        n,
        metrics: slot.metrics,
      });
    }
  }
  return out;
}

function buildTrends(root) {
  const conceptDir = path.join(root, "history", "concept_evidence");
  const issuesRoot = path.join(root, "issues");
  const helioDir = path.join(root, "history", "helio");
  const publishData = path.join(root, "publish", "data");

  // --- Research outcomes per cycle + per-concept trajectory --------------
  const cycles = [];
  const trajectory = new Map();
  for (const file of monthlyFiles(conceptDir)) {
    const month = file.replace(/\.json$/, "");
    const ce = readJson(path.join(conceptDir, file)) || {};
    const concepts = ce.concepts || [];
    const confidence = { high: 0, medium: 0, low: 0, unknown: 0 };
    const decisions = {};
    const weeks = new Set();
    let strengthSum = 0;
    let strengthN = 0;
    for (const c of concepts) {
      const conf = normConfidence(c.matched_confidence);
      confidence[conf] = (confidence[conf] || 0) + 1;
      const dec = normDecision(c.matched_decision_status);
      decisions[dec] = (decisions[dec] || 0) + 1;
      if (typeof c.evidence_strength_score === "number") {
        strengthSum += c.evidence_strength_score;
        strengthN += 1;
      }
      for (const w of c.weeks_seen || []) if (w) weeks.add(w);
      const key = c.concept_key || c.concept_id || c.concept_display || "unknown";
      if (!trajectory.has(key)) {
        trajectory.set(key, {
          key,
          display: c.concept_display || c.concept_title || key,
          points: [],
        });
      }
      trajectory.get(key).points.push({
        month,
        confidence: conf,
        decision: dec,
        strength: typeof c.evidence_strength_score === "number" ? c.evidence_strength_score : null,
      });
    }
    const sortedWeeks = [...weeks].sort();
    cycles.push({
      month,
      date_range: { min: sortedWeeks[0] || null, max: sortedWeeks[sortedWeeks.length - 1] || null },
      concept_count: typeof ce.concept_count === "number" ? ce.concept_count : concepts.length,
      with_evidence_count:
        typeof ce.with_evidence_count === "number" ? ce.with_evidence_count : null,
      confidence_breakdown: confidence,
      decision_breakdown: decisions,
      avg_evidence_strength: strengthN ? Math.round((strengthSum / strengthN) * 10) / 10 : null,
      finding_count: null,
    });
  }

  // --- Issues (hero cards) + findings + respondent quotes ----------------
  const quotes = [];
  const issues = [];
  const findingCountByMonth = {};
  const issueMonths = monthDirs(issuesRoot);
  // Chronological issue numbers (oldest = 01) — the fallback when an issue's
  // default.json lacks an explicit number (e.g. the first issue).
  const numberByMonth = {};
  [...issueMonths].sort().forEach((m, i) => {
    numberByMonth[m] = String(i + 1).padStart(2, "0");
  });
  for (const month of issueMonths) {
    const issue = readJson(path.join(issuesRoot, month, "default.json"));
    if (!issue) continue;
    const findings = [...(issue.surfaced_findings || []), ...(issue.comparison_tests || [])];
    findingCountByMonth[month] = findings.length;
    const issueMeta = issue.issue && typeof issue.issue === "object" ? issue.issue : {};
    // `summary` is a stats object; `executive_summary` is the prose string.
    const summaryText =
      [issue.executive_summary, issue.summary].find((s) => typeof s === "string") || "";
    issues.push({
      month,
      label: monthLabel(month),
      issue_label: issueMeta.label || `Issue ${issueMeta.number || numberByMonth[month]}`,
      title: issue.title || `Research Roundup — ${monthLabel(month)}`,
      summary: truncate(summaryText, 180),
      finding_count: findings.length,
      href: `issues/${month}/default.html`,
    });
    for (const f of issue.surfaced_findings || []) {
      if (f.respondent_quote) {
        quotes.push({
          month,
          title: f.title || null,
          quote: f.respondent_quote,
          confidence: normConfidence(f.confidence),
          decision: normDecision(f.decision_status),
        });
      }
    }
  }
  issues.sort((a, b) => b.month.localeCompare(a.month)); // newest first
  for (const cycle of cycles) {
    if (cycle.month in findingCountByMonth) cycle.finding_count = findingCountByMonth[cycle.month];
  }

  // --- Helio UX-metric time series --------------------------------------
  const helioMetrics = [];
  const seen = new Set();
  for (const file of monthlyFiles(helioDir)) {
    const month = file.replace(/\.json$/, "");
    for (const row of helioRows(readJson(path.join(helioDir, file)), month)) {
      helioMetrics.push(row);
      seen.add(`${row.month}|${row.test_id}`);
    }
  }
  // Current build's Helio metrics (no committed history yet on first runs).
  const currentHelio = readJson(path.join(publishData, "helio_evidence.json"));
  if (currentHelio) {
    const manifest = readJson(path.join(publishData, "refresh_manifest.json")) || {};
    const dmax =
      (manifest.date_range && manifest.date_range.max) ||
      (cycles.length ? cycles[cycles.length - 1].date_range.max : null);
    const month = (dmax || "").slice(0, 7) || "current";
    for (const row of helioRows(currentHelio, month)) {
      if (!seen.has(`${row.month}|${row.test_id}`)) helioMetrics.push(row);
    }
  }
  // Backfill null concepts by cross-referencing the same test_id elsewhere: the
  // same Helio test is often linked from several slides, some of which inferred a
  // concept and some didn't. This rescues most "untitled" comparisons.
  const conceptByTest = {};
  for (const row of helioMetrics) {
    if (row.concept && !conceptByTest[row.test_id]) conceptByTest[row.test_id] = row.concept;
  }
  for (const row of helioMetrics) {
    if (!row.concept && conceptByTest[row.test_id]) row.concept = conceptByTest[row.test_id];
  }

  return {
    cycles,
    concepts: [...trajectory.values()],
    issues,
    helio_metrics: helioMetrics,
    quotes,
    metric_keys: [
      "overall_ux",
      "engagement",
      "expectations",
      "comprehension",
      "intent",
      "sentiment",
    ],
  };
}

function main() {
  const root = path.resolve(process.argv[2] || ".");
  const trends = { generated_at: new Date().toISOString(), ...buildTrends(root) };
  const outDir = path.join(root, "publish", "data");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "trends.json"),
    JSON.stringify(trends, null, 2) + "\n",
    "utf8"
  );
  console.log(
    JSON.stringify(
      {
        cycles: trends.cycles.length,
        concepts: trends.concepts.length,
        helio_metrics: trends.helio_metrics.length,
        quotes: trends.quotes.length,
        output: path.join(outDir, "trends.json"),
      },
      null,
      2
    )
  );
}

if (require.main === module) main();

module.exports = {
  buildTrends,
  helioRows,
  normConfidence,
  normDecision,
  metricKey,
  monthLabel,
  truncate,
};
