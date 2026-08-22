"use strict";

// Smoke test for the Node evidence pipeline. Seeds a temp publish/ dir with the
// committed parsed fixtures in output/, runs build_evidence_packs.js against it,
// and asserts a valid evidence pack is written.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

test("build_evidence_packs.js produces a valid evidence pack from parsed outputs", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "everpure-evidence-"));
  const dataDir = path.join(tmp, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  for (const file of ["weeks.json", "deck_content.json"]) {
    const src = path.join(ROOT, "output", file);
    assert.ok(fs.existsSync(src), `missing committed fixture output/${file}`);
    fs.copyFileSync(src, path.join(dataDir, file));
  }

  execFileSync("node", [path.join(ROOT, "netlify", "build_evidence_packs.js"), tmp], {
    stdio: "pipe",
  });

  const out = path.join(dataDir, "evidence_packs.json");
  assert.ok(fs.existsSync(out), "evidence_packs.json should be written");

  const payload = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.ok(Array.isArray(payload.packs), "payload should contain a packs array");
  assert.strictEqual(typeof payload.pack_count, "number", "payload should report pack_count");

  // The hyphenated alias is part of the published contract.
  assert.ok(
    fs.existsSync(path.join(dataDir, "evidence-packs.json")),
    "hyphenated alias evidence-packs.json should also be written"
  );
});

test("build_evidence_packs.js merges Helio comparisons into packs", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "everpure-evidence-helio-"));
  const dataDir = path.join(tmp, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  fs.writeFileSync(path.join(dataDir, "weeks.json"), "[]");
  fs.writeFileSync(path.join(dataDir, "deck_content.json"), "[]");
  fs.writeFileSync(
    path.join(dataDir, "helio_evidence.json"),
    JSON.stringify({
      evidence: [
        // Two compare objects that share one real concept via the slide's own
        // "<Label> | <Type> | Concept <NN>" caption should merge into one pack.
        {
          compare_id: "cmp-a",
          derived_title: "1touch Product",
          deck_file_id: "deck-1",
          slide_text_excerpt:
            "Chat Avatar | Design | Concept 199 | Source: Data Comparison | Each person met one avatar cold.",
          associated_weeks: ["2026-08-06"],
          variants: [{ name: "Everly" }, { name: "Valencia" }],
          metrics: [
            {
              label: "Comprehension",
              values: [
                { name: "Everly", score: 72, qual_label: "High" },
                { name: "Valencia", score: 68, qual_label: "Average" },
              ],
            },
          ],
        },
        {
          compare_id: "cmp-b",
          derived_title: "F703486b 333d 4303 B449 Dd8a7807bbee",
          deck_file_id: "deck-1",
          slide_text_excerpt: "Chat Avatar | Decisions | Concept 199 | Ship Everly as primary.",
          associated_weeks: ["2026-08-13"],
          variants: [],
          metrics: [],
        },
        // A clean derived_title with no parseable caption is used as-is.
        {
          compare_id: "cmp-c",
          derived_title: "Product Pages FlashArray vs Product Pages FlashBlade",
          deck_file_id: "deck-2",
          slide_text_excerpt:
            "Visitors understand the category but cannot articulate the positioning.",
          associated_weeks: ["2026-07-30"],
          variants: [{ name: "FlashArray" }, { name: "FlashBlade" }],
          metrics: [],
        },
        // A garbled derived_title with no parseable caption cannot be honestly
        // labeled, so it should be skipped rather than surfaced as junk.
        {
          compare_id: "cmp-d",
          derived_title: "960d4d46912e97f6a88c6939 vs f703486b333d4303b449dd8a7807bbee",
          deck_file_id: "deck-3",
          slide_text_excerpt: "No usable caption here either.",
          associated_weeks: ["2026-07-30"],
          variants: [],
          metrics: [],
        },
      ],
    })
  );

  execFileSync("node", [path.join(ROOT, "netlify", "build_evidence_packs.js"), tmp], {
    stdio: "pipe",
  });

  const payload = JSON.parse(fs.readFileSync(path.join(dataDir, "evidence_packs.json"), "utf8"));
  const byTitle = new Map(payload.packs.map((p) => [p.concept_title, p]));

  const chatAvatar = byTitle.get("Chat Avatar");
  assert.ok(chatAvatar, "should produce a pack titled from the slide caption");
  assert.strictEqual(chatAvatar.concept_id, "199");
  assert.strictEqual(
    chatAvatar.helio_compare_ids.length,
    2,
    "both compare objects tagged Concept 199 should merge into one pack"
  );
  assert.ok(
    chatAvatar.supporting_numbers.includes("72") && chatAvatar.supporting_numbers.includes("68"),
    "should carry the real comprehension scores"
  );

  const flash = byTitle.get("Product Pages FlashArray vs Product Pages FlashBlade");
  assert.ok(flash, "a clean derived_title with no caption should be used as-is");

  const garbled = payload.packs.find((p) =>
    (p.source_refs || []).some((r) => r.helio_compare_id === "cmp-d")
  );
  assert.strictEqual(
    garbled,
    undefined,
    "an unlabelable garbled comparison should be skipped, not guessed at"
  );
});

test("clean_evidence_signals.js keeps short-but-real multi-word titles", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "everpure-clean-signals-"));
  const dataDir = path.join(tmp, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const pack = {
    concept_key: "helio_concept_199",
    concept_id: "199",
    // "Chat Avatar" is 11 characters - shorter than the 12-char minimum used
    // to filter junk evidence *sentences*, but a perfectly legitimate title.
    concept_title: "Chat Avatar",
    concept_display: "Concept 199 - Chat Avatar",
    weeks_seen: ["2026-08-06"],
    source_refs: [],
    raw_finding_excerpts: [
      "Each person met one avatar cold, with just her name, photo, and first message.",
    ],
    supporting_numbers: ["72", "68"],
    comparison_cues: ["comparison"],
    behavioral_signals: ["comprehension"],
    deck_refs: ["deck-1"],
  };
  const payload = { packs: [pack], pack_count: 1 };

  for (const name of ["evidence_packs.json", "evidence_packs_default_30d.json"]) {
    fs.writeFileSync(path.join(dataDir, name), JSON.stringify(payload));
  }

  execFileSync("node", [path.join(ROOT, "netlify", "clean_evidence_signals.js"), tmp], {
    stdio: "pipe",
  });

  const cleaned = JSON.parse(fs.readFileSync(path.join(dataDir, "evidence_packs.json"), "utf8"));
  assert.strictEqual(cleaned.packs.length, 1, "a short but real multi-word title should survive");
  assert.strictEqual(cleaned.packs[0].concept_title, "Chat Avatar");
});

test("build_evidence_packs.js doesn't span a sentence break into a garbled title", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "everpure-evidence-sentence-"));
  const dataDir = path.join(tmp, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  // A two-sentence bullet where the first sentence ends before a name that
  // happens to precede "needs to" - the concept-title patterns should not
  // grab the whole span (first sentence + name) as a single title.
  const weeks = [
    {
      week_date: "2026-08-06",
      record_id: "everpure_2026_08_06",
      content_groups: {
        other: [
          {
            text: "Get the next concepts into testing. Brandon needs to provide the hunch/angle for the chatbot experience so we can quickly build a test.",
            level: 1,
            children: [],
          },
        ],
      },
    },
  ];
  fs.writeFileSync(path.join(dataDir, "weeks.json"), JSON.stringify(weeks));
  fs.writeFileSync(path.join(dataDir, "deck_content.json"), "[]");

  execFileSync("node", [path.join(ROOT, "netlify", "build_evidence_packs.js"), tmp], {
    stdio: "pipe",
  });

  const payload = JSON.parse(fs.readFileSync(path.join(dataDir, "evidence_packs.json"), "utf8"));
  const garbled = payload.packs.find((p) =>
    (p.concept_title || "").toLowerCase().includes("brandon")
  );
  assert.strictEqual(
    garbled,
    undefined,
    "a title spanning a sentence break into a trailing name should not become a pack"
  );
});

test("build_evidence_packs.js rejects a title made entirely of generic words", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "everpure-evidence-generic-title-"));
  const dataDir = path.join(tmp, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  // "Our focus should shift..." is a single sentence (no sentence-break bug),
  // but "Our focus" names no reader-recognizable concept - it's a vague lead-in,
  // not a real title, and should not become a pack.
  const weeks = [
    {
      week_date: "2026-08-06",
      record_id: "everpure_2026_08_06",
      content_groups: {
        other: [
          {
            text: "Our focus should shift from messaging to experience. Across both studies, the positioning is largely working.",
            level: 1,
            children: [],
          },
        ],
      },
    },
  ];
  fs.writeFileSync(path.join(dataDir, "weeks.json"), JSON.stringify(weeks));
  fs.writeFileSync(path.join(dataDir, "deck_content.json"), "[]");

  execFileSync("node", [path.join(ROOT, "netlify", "build_evidence_packs.js"), tmp], {
    stdio: "pipe",
  });

  const payload = JSON.parse(fs.readFileSync(path.join(dataDir, "evidence_packs.json"), "utf8"));
  const generic = payload.packs.find((p) => (p.concept_title || "").toLowerCase() === "our focus");
  assert.strictEqual(
    generic,
    undefined,
    "a title made entirely of generic pronouns/vague nouns should not become a pack"
  );
});

test("render_stage2_default_current.js: excluded_titles, recommended_action override, and no orphan actions", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "everpure-render-"));
  const dataDir = path.join(tmp, "data");
  const newsletterDir = path.join(tmp, "newsletter");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(newsletterDir, { recursive: true });

  // Eight comparison-eligible packs, ranked purely by last_seen_week
  // (occurrence and evidence-line counts held equal/empty so recency alone
  // controls groupRankScore, making selection order predictable):
  //   Alpha/Bravo/Charlie Widget (08-20..08-18) -> the 3 preferred Findings
  //     (given all 3 explicitly so buildNarrativeFindings' fill-to-3 autofill
  //     never triggers and doesn't entangle this test)
  //   Alpha Widget Legacy (08-17)         -> excluded via selection.excluded_titles
  //   Gamma Comparison Test (08-16)        -> wins comparison slot 1
  //   Delta Comparison Test (08-15)        -> wins comparison slot 2
  //   Beta Comparison Test (08-14)         -> ranks 7th - would have filled an
  //                                           old-style top-5 action slot
  //   Epsilon Comparison Test (08-13)      -> ranks 8th, same risk as Beta
  // Neither Beta nor Epsilon is a Finding, Comparison, or Unresolved item, so
  // Recommended Actions must not surface them as orphaned entries.
  function pack(title, lastSeenWeek) {
    return {
      concept_key: title.toLowerCase(),
      concept_title: title,
      concept_display: title,
      weeks_seen: [lastSeenWeek],
      first_seen_week: lastSeenWeek,
      last_seen_week: lastSeenWeek,
      occurrence_count: 1,
      deck_refs: [],
      source_refs: [],
      raw_finding_excerpts: [],
      comparison_cues: ["comparison"],
      behavioral_signals: [],
    };
  }
  const packs = [
    pack("Alpha Widget", "2026-08-20"),
    pack("Bravo Widget", "2026-08-19"),
    pack("Charlie Widget", "2026-08-18"),
    pack("Alpha Widget Legacy", "2026-08-17"),
    pack("Gamma Comparison Test", "2026-08-16"),
    pack("Delta Comparison Test", "2026-08-15"),
    pack("Beta Comparison Test", "2026-08-14"),
    pack("Epsilon Comparison Test", "2026-08-13"),
  ];
  const packsPayload = { generated_at: "2026-08-22T00:00:00Z", pack_count: packs.length, packs };

  fs.writeFileSync(path.join(dataDir, "weeks.json"), "[]");
  fs.writeFileSync(path.join(dataDir, "concept-evidence-default-30d.json"), "[]");
  fs.writeFileSync(
    path.join(dataDir, "evidence-packs-default-30d.json"),
    JSON.stringify(packsPayload)
  );
  fs.writeFileSync(path.join(tmp, "status.json"), "{}");

  const contentFile = path.join(tmp, "content.json");
  const preferredFindings = ["Alpha Widget", "Bravo Widget", "Charlie Widget"];
  fs.writeFileSync(
    contentFile,
    JSON.stringify({
      note: "test note",
      selection: {
        findings_preferred_order: preferredFindings,
        unresolved_preferred_order: preferredFindings,
        excluded_titles: ["Alpha Widget Legacy"],
      },
      topics: {
        alpha_widget: {
          next_step: "Alpha Widget direction copy",
          recommended_action: "Alpha Widget: distinct operational action copy",
        },
        gamma_comparison_test: {
          comparison_statement: "Gamma-specific comparison statement",
          comparison_criteria: "Gamma-specific decision criteria",
        },
      },
    })
  );

  execFileSync("node", [path.join(ROOT, "netlify", "render_stage2_default_current.js"), tmp], {
    stdio: "pipe",
    env: { ...process.env, STAGE2_CONTENT_FILE: contentFile },
  });

  const rendered = JSON.parse(fs.readFileSync(path.join(newsletterDir, "default.json"), "utf8"));

  const findingTitles = rendered.surfaced_findings.map((f) => f.title);
  assert.deepStrictEqual(findingTitles.sort(), [...preferredFindings].sort());

  const comparisonTitles = rendered.comparison_tests.map((c) => c.title);
  assert.deepStrictEqual(
    comparisonTitles,
    ["Gamma Comparison Test", "Delta Comparison Test"],
    "excluded_titles should remove 'Alpha Widget Legacy' from comparison candidates"
  );

  const gamma = rendered.comparison_tests.find((c) => c.title === "Gamma Comparison Test");
  assert.strictEqual(gamma.finding_statement, "Gamma-specific comparison statement");
  assert.strictEqual(gamma.decision_criteria, "Gamma-specific decision criteria");

  const alphaFinding = rendered.surfaced_findings.find((f) => f.title === "Alpha Widget");
  assert.strictEqual(alphaFinding.next_step, "Alpha Widget direction copy");

  const actionTopics = (rendered.recommended_actions || rendered.next_actions || []).map(
    (a) => a.topic
  );
  assert.deepStrictEqual(
    actionTopics.sort(),
    [...preferredFindings, "Gamma Comparison Test", "Delta Comparison Test"].sort(),
    "Recommended Actions must only cover topics already surfaced as a Finding/Comparison/Unresolved item"
  );

  const alphaAction = (rendered.recommended_actions || rendered.next_actions || []).find(
    (a) => a.topic === "Alpha Widget"
  );
  assert.strictEqual(
    alphaAction.action,
    "Alpha Widget: distinct operational action copy",
    "recommended_action override should differ from the Direction/next_step copy"
  );
});
