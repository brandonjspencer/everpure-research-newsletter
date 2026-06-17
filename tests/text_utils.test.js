"use strict";

const test = require("node:test");
const assert = require("node:assert");
const {
  stripLeadingConceptLabel,
  normalizeLigatures,
  sanitizeEvidenceSegments,
  pickBestEvidence,
  composeEvidenceSummary,
} = require("../netlify/text_utils");

test("strips a duplicated concept label from the front of an evidence line", () => {
  // The three real June findings that surfaced the bug.
  assert.strictEqual(
    stripLeadingConceptLabel(
      "EDC Blueprint Users understand the Enterprise Data Cloud category, but they don't clearly understand what the Blueprint delivers.",
      "EDC Blueprint Page"
    ),
    "Users understand the Enterprise Data Cloud category, but they don't clearly understand what the Blueprint delivers."
  );
  assert.strictEqual(
    stripLeadingConceptLabel(
      "Accelerate Live Stream The biggest opportunity is making it immediately obvious that the event is live.",
      "Accelerate Live Stream"
    ),
    "The biggest opportunity is making it immediately obvious that the event is live."
  );
  assert.strictEqual(
    stripLeadingConceptLabel(
      "Contextual Intelligence Users recognize the AI and data management category.",
      "Contextual Intelligence PDP"
    ),
    "Users recognize the AI and data management category."
  );
});

test("leaves a clean evidence line untouched", () => {
  const clean = "Users understand the category but need clearer next steps.";
  assert.strictEqual(stripLeadingConceptLabel(clean, "EDC Blueprint Page"), clean);
});

test("does not strip a single coincidental leading word", () => {
  // Only the first word matches the title — must not be truncated.
  const text = "Platform messaging tested better than the storage framing.";
  assert.strictEqual(stripLeadingConceptLabel(text, "Platform Diagram Update"), text);
});

test("recapitalizes the new first word when needed", () => {
  assert.strictEqual(
    stripLeadingConceptLabel(
      "Accelerate Live Stream the event felt live.",
      "Accelerate Live Stream"
    ),
    "The event felt live."
  );
});

test("never returns empty and tolerates missing inputs", () => {
  assert.strictEqual(stripLeadingConceptLabel("", "EDC Blueprint Page"), "");
  assert.strictEqual(
    stripLeadingConceptLabel("EDC Blueprint Page", "EDC Blueprint Page"),
    "EDC Blueprint Page"
  );
  assert.strictEqual(stripLeadingConceptLabel("Some text", ""), "Some text");
  assert.strictEqual(stripLeadingConceptLabel(undefined, "Title"), undefined);
});

test("normalizeLigatures repairs PDF ligature artifacts", () => {
  assert.strictEqual(
    normalizeLigatures("In the ﬁrst impression, diﬀerentiation and beneﬁt"),
    "In the first impression, differentiation and benefit"
  );
});

test("sanitizeEvidenceSegments splits off pipeline scaffolding", () => {
  const raw =
    "Action intent is fragmented and no single CTA dominates. Accelerate Live Stream Signal Concept 192 Source: Data Comparison";
  const segs = sanitizeEvidenceSegments(raw, "Accelerate Live Stream");
  assert.ok(
    segs.includes("Action intent is fragmented and no single CTA dominates."),
    JSON.stringify(segs)
  );
  // No segment should still carry scaffolding tokens.
  for (const s of segs) {
    assert.ok(!/Concept\s*\d+|Source:|Data Comparison/i.test(s), `scaffolding leaked: ${s}`);
  }
});

test("pickBestEvidence prefers a concrete signal over a hunch restatement", () => {
  const finding = "Users understand the category, but the page needs to make the outcome clearer.";
  const candidates = [
    // Hunch / near-restatement of the finding (should lose):
    "EDC Blueprint Page Exploring whether the assessment positioning feels credible and worth engaging with.",
    // Concrete surfaced signal with a verbatim quote (should win):
    'One respondent asked directly: "Why would you assume I\'d start an assessment straight away?" EDC Blueprint Page Signal Concept 191 Source: Data Comparison',
  ];
  const best = pickBestEvidence(candidates, {
    title: "EDC Blueprint Page",
    findingStatement: finding,
  });
  assert.strictEqual(
    best,
    'One respondent asked directly: "Why would you assume I\'d start an assessment straight away?"'
  );
});

test("pickBestEvidence returns empty when nothing is concrete enough", () => {
  const candidates = [
    "EDC Blueprint Page Exploring whether the positioning feels credible and worth engaging with.",
  ];
  assert.strictEqual(pickBestEvidence(candidates, { title: "EDC Blueprint Page" }), "");
});

test("composeEvidenceSummary joins distinct signals and respects the length cap", () => {
  const candidates = [
    "Action intent is fragmented and no single CTA dominates. Signal Concept 192 Source: Data Comparison",
    "Autoplay expectation mismatch creates friction for the keynote. Concept 192 Source: Figma File",
  ];
  const out = composeEvidenceSummary(candidates, { title: "Accelerate Live Stream" }, 220);
  assert.ok(out.length <= 220, `exceeded cap: ${out.length}`);
  assert.ok(/fragmented/.test(out) && /Autoplay/.test(out), `missing a signal: ${out}`);
  assert.ok(!/Concept\s*\d+|Source:/i.test(out), `scaffolding leaked: ${out}`);
});

test("composeEvidenceSummary truncates an overlong single segment at a boundary", () => {
  const long =
    "Respondents described the page as data cloud storage in the first impression test, " +
    "and many asked what the assessment would actually produce before starting it, " +
    "while others clicked through without understanding the outcome at all.";
  const out = composeEvidenceSummary([long], { title: "EDC Blueprint Page" }, 120);
  assert.ok(out.length <= 121, `exceeded cap: ${out.length}`);
});
