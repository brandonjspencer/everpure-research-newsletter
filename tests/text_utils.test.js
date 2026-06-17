"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { stripLeadingConceptLabel } = require("../netlify/text_utils");

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
