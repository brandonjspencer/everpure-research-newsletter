#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return fallback;
  }
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function maxDate(dates) {
  return dates.reduce((a, b) => (a > b ? a : b));
}

function addDays(dateStr, deltaDays) {
  const dt = new Date(dateStr + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function unique(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function topLevelTexts(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => (item && typeof item.text === "string" ? item.text.trim() : ""))
    .filter(Boolean);
}

function sentenceCase(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function canonicalKey(title) {
  const raw = (title || "").trim();
  const lower = raw.toLowerCase();
  if (!lower) return "";
  if (lower.includes("knowledge portal") || lower.includes("support taxonomy") || lower.includes("platform redesign") || lower.includes("knowledge portal domain")) {
    return "knowledge-portal-platform";
  }
  if (lower.includes("homepage ai messaging") || lower.includes("ai summary")) {
    return "ai-messaging";
  }
  if (lower.includes("evergreen rebrand")) {
    return "evergreen-rebrand";
  }
  if (lower.includes("pathfinder")) {
    return "pathfinder";
  }
  if (lower.includes("events page") || lower.includes("events v1") || lower.includes("events v2")) {
    return "events-page";
  }
  if (lower.includes("design & ux feedback") || lower.includes("design and ux feedback") || lower.includes("reader page") || lower.includes("search page") || lower.includes("header")) {
    return "design-feedback";
  }
  return lower
    .replace(/^\d+\s*[-–:]\s*/, "")
    .replace(/\(in process\)/gi, "")
    .replace(/\bbaseline\b/gi, "")
    .replace(/\bvariations?\b/gi, "")
    .replace(/\br\d+\b/gi, "")
    .replace(/\bv\d+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function displayForKey(key, samples = []) {
  switch (key) {
    case "knowledge-portal-platform":
      return "Knowledge portal and platform structure";
    case "ai-messaging":
      return "AI messaging and summary framing";
    case "evergreen-rebrand":
      return "Evergreen rebrand";
    case "pathfinder":
      return "Pathfinder journey and CTA clarity";
    case "events-page":
      return "Events page work";
    case "design-feedback":
      return "Cross-page design and UX feedback";
    default:
      return sentenceCase(samples[0] || key);
  }
}

function findComparisonCue(title) {
  const lower = (title || "").toLowerCase();
  return ["baseline", "variation", "variations", "compare", "comparison", "review", "r2", "r3", "v1", "v2"].some((cue) => lower.includes(cue));
}

function comparisonNextQuestion(key, samples) {
  switch (key) {
    case "events-page":
      return "What specific page element or content treatment will define the winner between the remaining Events variants?";
    case "ai-messaging":
      return "Which one or two summary framings are strongest enough to carry into the next deciding round?";
    case "evergreen-rebrand":
      return "Which visual pacing treatment improves appeal without lowering comprehension?";
    case "knowledge-portal-platform":
      return "Which naming and entry-point framing makes the portal feel most discoverable and useful?";
    default:
      return `What should the next deciding comparison prove for ${displayForKey(key, samples)}?`;
  }
}

function bulletList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtml(doc) {
  const weeklyRows = doc.weekly_activity_log
    .map((item) => `<li><strong>${esc(item.week_date)}</strong> — ${esc(item.summary)}</li>`)
    .join("\n");

  const activeRows = doc.active_workstreams
    .map((item) => `<li><strong>${esc(item.title)}</strong> — Mentioned ${esc(String(item.mentions))} time(s). ${esc(item.readout)}</li>`)
    .join("\n");

  const threadRows = doc.repeated_threads
    .map((item) => `<li><strong>${esc(item.theme)}</strong> — ${esc(item.readout)}</li>`)
    .join("\n");

  const comparisonRows = doc.comparison_work_in_flight
    .map((item) => `<li><strong>${esc(item.title)}</strong> — ${esc(item.readout)} <em>Next question:</em> ${esc(item.next_question)}</li>`)
    .join("\n");

  const howRows = doc.how_to_use_log.map((item) => `<li>${esc(item)}</li>`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(doc.title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px auto; max-width: 860px; padding: 0 20px; line-height: 1.55; color: #1f2937; }
    h1, h2 { line-height: 1.2; }
    h1 { margin-bottom: 8px; }
    .meta { color: #4b5563; font-size: 0.95rem; margin-bottom: 24px; }
    .panel { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px 18px; margin: 18px 0 24px; }
    ul { padding-left: 22px; }
    li { margin: 8px 0; }
    .small { color: #6b7280; font-size: 0.92rem; }
  </style>
</head>
<body>
  <h1>${esc(doc.title)}</h1>
  <div class="meta">Generated: ${esc(doc.generated_at)} • Window: ${esc(doc.window.since)} to ${esc(doc.window.until)} • Audience: ${esc(doc.audience)} • Tone: ${esc(doc.tone)} • Mode: ${esc(doc.mode)}</div>

  <div class="panel">
    <strong>Executive summary</strong>
    <p>${esc(doc.executive_summary)}</p>
  </div>

  <h2>Snapshot</h2>
  <ul>
    <li>Weeks covered: ${esc(String(doc.overview.week_count))}</li>
    <li>Items surfaced: ${esc(String(doc.overview.item_count))}</li>
    <li>Decks linked: ${esc(String(doc.overview.deck_count))}</li>
    <li>Decks with ingested text: ${esc(String(doc.overview.decks_with_content_count))}</li>
  </ul>

  <h2>Volume snapshot</h2>
  <ul>
    <li>Total tracked items: ${esc(String(doc.volume_snapshot.total_tracked_items))}</li>
    <li>Findings: ${esc(String(doc.volume_snapshot.findings))}</li>
    <li>Testing concepts: ${esc(String(doc.volume_snapshot.testing_concepts))}</li>
    <li>In progress: ${esc(String(doc.volume_snapshot.in_progress))}</li>
    <li>Average items per week: ${esc(String(doc.volume_snapshot.average_items_per_week))}</li>
  </ul>

  <h2>Weekly activity log</h2>
  <ul>
    ${weeklyRows}
  </ul>

  <h2>Active workstreams</h2>
  <ul>
    ${activeRows}
  </ul>

  <h2>Repeated research threads</h2>
  <ul>
    ${threadRows}
  </ul>

  <h2>Comparison work in flight</h2>
  <ul>
    ${comparisonRows}
  </ul>

  <h2>How to use this log</h2>
  <ul>
    ${howRows}
  </ul>

  <p class="small">This artifact is optimized for cadence, throughput, and research visibility. It is not intended to be a ship-readiness brief.</p>
</body>
</html>`;
}

function renderMarkdown(doc) {
  return [
    `# ${doc.title}`,
    "",
    `_Generated: ${doc.generated_at}_`,
    `_Window: ${doc.window.since} to ${doc.window.until}_`,
    `_Audience: ${doc.audience} | Tone: ${doc.tone} | Mode: ${doc.mode}_`,
    "",
    "## Executive summary",
    doc.executive_summary,
    "",
    "## Snapshot",
    bulletList([
      `Weeks covered: ${doc.overview.week_count}`,
      `Items surfaced: ${doc.overview.item_count}`,
      `Decks linked: ${doc.overview.deck_count}`,
      `Decks with ingested text: ${doc.overview.decks_with_content_count}`,
    ]),
    "",
    "## Volume snapshot",
    bulletList([
      `Total tracked items: ${doc.volume_snapshot.total_tracked_items}`,
      `Findings: ${doc.volume_snapshot.findings}`,
      `Testing concepts: ${doc.volume_snapshot.testing_concepts}`,
      `In progress: ${doc.volume_snapshot.in_progress}`,
      `Average items per week: ${doc.volume_snapshot.average_items_per_week}`,
    ]),
    "",
    "## Weekly activity log",
    bulletList(doc.weekly_activity_log.map((item) => `**${item.week_date}** — ${item.summary}`)),
    "",
    "## Active workstreams",
    bulletList(doc.active_workstreams.map((item) => `**${item.title}** — Mentioned ${item.mentions} time(s). ${item.readout}`)),
    "",
    "## Repeated research threads",
    bulletList(doc.repeated_threads.map((item) => `**${item.theme}** — ${item.readout}`)),
    "",
    "## Comparison work in flight",
    bulletList(doc.comparison_work_in_flight.map((item) => `**${item.title}** — ${item.readout} Next question: ${item.next_question}`)),
    "",
    "## How to use this log",
    bulletList(doc.how_to_use_log),
    "",
    "This artifact is optimized for cadence, throughput, and research visibility. It is not intended to be a ship-readiness brief.",
    "",
  ].join("\n");
}

function main() {
  const publishDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve("publish");
  const dataDir = path.join(publishDir, "data");
  const weeks = readJson(path.join(dataDir, "weeks.json"), []);
  const deckContent = readJson(path.join(dataDir, "deck_content.json"), readJson(path.join(dataDir, "deck-content.json"), []));

  if (!Array.isArray(weeks) || weeks.length === 0) {
    throw new Error("No weeks.json records available for marketing stage-2 writer.");
  }

  const latestWeek = maxDate(weeks.map((r) => r.week_date).filter(Boolean));
  const since = addDays(latestWeek, -29);
  const windowRecords = weeks
    .filter((r) => r.week_date && r.week_date >= since && r.week_date <= latestWeek)
    .sort((a, b) => (a.week_date < b.week_date ? 1 : -1));

  const deckIds = unique(windowRecords.map((r) => (r.deck && r.deck.file_id) || null));
  const deckIdsWithContent = unique((Array.isArray(deckContent) ? deckContent : []).map((d) => d.deck_id || d.file_id || null)).filter((id) => deckIds.includes(id));

  let findings = 0;
  let testingConcepts = 0;
  let inProgress = 0;
  const workstreamMap = new Map();
  const threadMap = new Map();
  const comparisonMap = new Map();

  const weeklyActivity = windowRecords.map((record) => {
    const groups = record.content_groups || {};
    const findingTitles = topLevelTexts(groups.findings);
    const testingTitles = topLevelTexts(groups.testing_concepts);
    const progressTitles = topLevelTexts(groups.in_process);

    findings += findingTitles.length;
    testingConcepts += testingTitles.length;
    inProgress += progressTitles.length;

    const visibleTitles = unique([...findingTitles, ...testingTitles, ...progressTitles]).slice(0, 3);

    for (const title of progressTitles) {
      const key = canonicalKey(title);
      if (!key) continue;
      if (!workstreamMap.has(key)) workstreamMap.set(key, { samples: [], mentions: 0 });
      const entry = workstreamMap.get(key);
      entry.mentions += 1;
      entry.samples.push(title);
    }

    for (const title of unique([...findingTitles, ...testingTitles, ...progressTitles])) {
      const key = canonicalKey(title);
      if (!key) continue;
      if (!threadMap.has(key)) threadMap.set(key, { samples: [], mentions: 0, weeks: new Set() });
      const entry = threadMap.get(key);
      entry.mentions += 1;
      entry.samples.push(title);
      entry.weeks.add(record.week_date);
      if (findComparisonCue(title)) {
        if (!comparisonMap.has(key)) comparisonMap.set(key, { samples: [], mentions: 0, weeks: new Set() });
        const comp = comparisonMap.get(key);
        comp.mentions += 1;
        comp.samples.push(title);
        comp.weeks.add(record.week_date);
      }
    }

    return {
      week_date: record.week_date,
      summary: visibleTitles.join("; ") || "No named concepts surfaced in the weekly note.",
      source_refs: [{ week_date: record.week_date, record_id: record.record_id || null, deck_id: (record.deck && record.deck.file_id) || null }],
    };
  });

  const activeWorkstreams = Array.from(workstreamMap.entries())
    .sort((a, b) => b[1].mentions - a[1].mentions || displayForKey(a[0], a[1].samples).localeCompare(displayForKey(b[0], b[1].samples)))
    .slice(0, 6)
    .map(([key, value]) => ({
      title: displayForKey(key, value.samples),
      mentions: value.mentions,
      readout: `${displayForKey(key, value.samples)} remained active across the month and is best read as an ongoing workstream rather than a closed finding.`,
    }));

  const repeatedThreads = Array.from(threadMap.entries())
    .filter(([, value]) => value.weeks.size >= 2)
    .sort((a, b) => b[1].weeks.size - a[1].weeks.size || b[1].mentions - a[1].mentions)
    .slice(0, 5)
    .map(([key, value]) => ({
      theme: displayForKey(key, value.samples),
      mentions: value.mentions,
      weeks_seen: value.weeks.size,
      readout: `${displayForKey(key, value.samples)} appeared in ${value.weeks.size} of the last ${windowRecords.length} weekly updates, making it one of the clearest repeated research threads in the month.`,
    }));

  const comparisonWork = Array.from(comparisonMap.entries())
    .sort((a, b) => b[1].weeks.size - a[1].weeks.size || b[1].mentions - a[1].mentions)
    .slice(0, 5)
    .map(([key, value]) => ({
      title: displayForKey(key, value.samples),
      mentions: value.mentions,
      readout: `${displayForKey(key, value.samples)} is no longer broad exploration work; it is in a narrower comparison phase with clearer decision pressure.`,
      next_question: comparisonNextQuestion(key, value.samples),
    }));

  const totalItems = findings + testingConcepts + inProgress;
  const avgPerWeek = windowRecords.length ? (totalItems / windowRecords.length).toFixed(1) : "0.0";

  const doc = {
    generated_at: new Date().toISOString(),
    title: "Everpure research activity log (30d)",
    audience: "marketing",
    tone: "detailed",
    mode: "activity_log",
    preset: "marketing_activity_30d",
    defaults: {
      window: "30d",
      audience: "marketing",
      tone: "detailed",
    },
    window: {
      since,
      until: latestWeek,
      label: "30d",
      days: 30,
    },
    overview: {
      week_count: windowRecords.length,
      item_count: totalItems,
      deck_count: deckIds.length,
      deck_ids: deckIds,
      decks_with_content_count: deckIdsWithContent.length,
      decks_with_content: deckIdsWithContent,
      date_range: { min: since, max: latestWeek },
    },
    executive_summary: `This 30-day view captures the cadence and volume of the research program: ${windowRecords.length} weekly updates, ${totalItems} tracked items, and repeated motion across findings, comparison work, and active workstreams.`,
    volume_snapshot: {
      total_tracked_items: totalItems,
      findings,
      testing_concepts: testingConcepts,
      in_progress: inProgress,
      average_items_per_week: Number(avgPerWeek),
    },
    weekly_activity_log: weeklyActivity,
    active_workstreams: activeWorkstreams,
    repeated_threads: repeatedThreads,
    comparison_work_in_flight: comparisonWork,
    how_to_use_log: [
      "Use this view to show consistency of research activity over the month, not to make ship decisions.",
      "Lead with cadence and volume, then show the repeated workstreams that are absorbing the most research attention.",
      "Use the comparison section to show where the team is moving from broad exploration into narrower decision-making.",
    ],
  };

  const markdown = renderMarkdown(doc);
  const html = renderHtml(doc);
  const json = JSON.stringify(doc, null, 2) + "\n";

  const newsletterDir = path.join(publishDir, "newsletter");
  const apiDir = path.join(publishDir, "api");
  writeFile(path.join(newsletterDir, "marketing-activity-30d.json"), json);
  writeFile(path.join(newsletterDir, "marketing-activity-30d.md"), markdown);
  writeFile(path.join(newsletterDir, "marketing-activity-30d.html"), html);
  writeFile(path.join(apiDir, "newsletter-marketing-activity-30d.json"), json);
  writeFile(path.join(apiDir, "newsletter-marketing-activity-30d.md"), markdown);

  console.log(JSON.stringify({
    generated_at: doc.generated_at,
    outputs: [
      path.join(newsletterDir, "marketing-activity-30d.json"),
      path.join(newsletterDir, "marketing-activity-30d.md"),
      path.join(newsletterDir, "marketing-activity-30d.html"),
      path.join(apiDir, "newsletter-marketing-activity-30d.json"),
      path.join(apiDir, "newsletter-marketing-activity-30d.md"),
    ],
    week_count: doc.overview.week_count,
    item_count: doc.overview.item_count,
    deck_count: doc.overview.deck_count,
  }, null, 2));
}

main();
