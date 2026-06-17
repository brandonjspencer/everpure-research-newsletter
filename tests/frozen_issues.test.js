"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { stripLeadingConceptLabel } = require("../netlify/text_utils");

// Regression guard for the "subject printed before the evidence" bug: a frozen
// finding's proof_point must not begin with a duplicate of its own title. We
// reuse the renderer's strip helper — if it would change the text, the archive
// still carries the redundant label prefix.
const issuesDir = path.join(__dirname, "..", "issues");

function issueJsonFiles() {
  if (!fs.existsSync(issuesDir)) return [];
  return fs
    .readdirSync(issuesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(issuesDir, e.name, "default.json"))
    .filter((p) => fs.existsSync(p));
}

test("frozen issue evidence does not repeat the finding title as a prefix", () => {
  const files = issueJsonFiles();
  assert.ok(files.length > 0, "expected at least one frozen issue to scan");
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const item of data.surfaced_findings || []) {
      const stripped = stripLeadingConceptLabel(item.proof_point, item.title);
      assert.strictEqual(
        stripped,
        item.proof_point,
        `${path.relative(issuesDir, file)} — finding "${item.title}" repeats its title in proof_point: ${JSON.stringify(item.proof_point)}`
      );
    }
  }
});
