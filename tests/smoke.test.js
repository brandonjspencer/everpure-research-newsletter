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
