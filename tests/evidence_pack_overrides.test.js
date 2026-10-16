"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { applyOverrides } = require("../netlify/apply_evidence_pack_overrides");

function setup({ latestWeek = "2026-10-15", overrides }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pack-overrides-"));
  const data = path.join(root, "data");
  fs.mkdirSync(data, { recursive: true });
  const window = {
    latest_week_date: latestWeek,
    window: { days: 30, end: latestWeek },
    pack_count: 2,
    packs: [{ concept_title: "📊 Data Comparison" }, { concept_title: "Video and Homepage" }],
  };
  fs.writeFileSync(path.join(data, "evidence_packs_default_30d.json"), JSON.stringify(window));
  fs.writeFileSync(
    path.join(data, "evidence_packs.json"),
    JSON.stringify({
      pack_count: 2,
      packs: [{ concept_title: "Old Topic" }, { concept_title: "Newsroom" }],
    })
  );
  const file = path.join(root, "overrides.json");
  fs.writeFileSync(file, JSON.stringify(overrides));
  const read = (name) => JSON.parse(fs.readFileSync(path.join(data, name), "utf8"));
  return { root, file, read };
}

const PACKS = [
  { concept_title: "Newsroom", source_refs: [{ text: "curated" }] },
  { concept_title: "Platform Menu" },
];

test("replaces the window packs and merges into the full pack file, both spellings", () => {
  const { root, file, read } = setup({
    overrides: {
      issue_month: "2026-10",
      replace_window_packs: true,
      provenance: "p",
      packs: PACKS,
    },
  });
  const result = applyOverrides(root, file);
  assert.strictEqual(result.applied, true);
  for (const name of ["evidence_packs_default_30d.json", "evidence-packs-default-30d.json"]) {
    const w = read(name);
    assert.deepStrictEqual(
      w.packs.map((p) => p.concept_title),
      ["Newsroom", "Platform Menu"]
    );
    assert.strictEqual(w.pack_count, 2);
    assert.strictEqual(w.provenance, "p");
  }
  for (const name of ["evidence_packs.json", "evidence-packs.json"]) {
    const full = read(name);
    assert.deepStrictEqual(
      full.packs.map((p) => p.concept_title),
      ["Old Topic", "Newsroom", "Platform Menu"]
    );
    assert.strictEqual(full.packs[1].source_refs[0].text, "curated");
  }
});

test("merge mode keeps other window packs and replaces same-titled ones", () => {
  const { root, file, read } = setup({
    overrides: { issue_month: "2026-10", packs: [{ concept_title: "Video and Homepage", x: 1 }] },
  });
  applyOverrides(root, file);
  const w = read("evidence_packs_default_30d.json");
  assert.deepStrictEqual(
    w.packs.map((p) => [p.concept_title, p.x]),
    [
      ["📊 Data Comparison", undefined],
      ["Video and Homepage", 1],
    ]
  );
});

test("skips when the window has moved past the overrides' issue month", () => {
  const { root, file, read } = setup({
    latestWeek: "2026-11-05",
    overrides: { issue_month: "2026-10", replace_window_packs: true, packs: PACKS },
  });
  const result = applyOverrides(root, file);
  assert.strictEqual(result.applied, false);
  assert.match(result.reason, /2026-11/);
  assert.strictEqual(
    read("evidence_packs_default_30d.json").packs[0].concept_title,
    "📊 Data Comparison"
  );
});

test("no-op when there are no override packs", () => {
  const { root, file } = setup({ overrides: { issue_month: "2026-10", packs: [] } });
  assert.strictEqual(applyOverrides(root, file).applied, false);
});
