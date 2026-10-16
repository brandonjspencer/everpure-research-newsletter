#!/usr/bin/env node
"use strict";

// Apply curated evidence-pack overrides (netlify/content/evidence_pack_overrides.json) to the
// build's packs, so CI renders the same issue the editor reviewed when the generated packs for a
// window are mis-titled or miss a test. Runs right before render_stage2_default_current.js.
//
// Usage: node netlify/apply_evidence_pack_overrides.js <publishDir> [overridesFile]

const fs = require("fs");
const path = require("path");

const DEFAULT_OVERRIDES = path.join(__dirname, "content", "evidence_pack_overrides.json");
const WINDOW_FILES = ["evidence_packs_default_30d.json", "evidence-packs-default-30d.json"];
const FULL_FILES = ["evidence_packs.json", "evidence-packs.json"];

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function windowMonth(payload) {
  const latest =
    (payload && (payload.latest_week_date || (payload.window && payload.window.end))) || "";
  return String(latest).slice(0, 7);
}

function mergeByTitle(existing, overrides) {
  const titles = new Set(overrides.map((p) => p.concept_title));
  return [...existing.filter((p) => !titles.has(p && p.concept_title)), ...overrides];
}

function applyOverrides(publishDir, overridesFile = DEFAULT_OVERRIDES) {
  const config = readJson(overridesFile);
  const packs = config && Array.isArray(config.packs) ? config.packs : [];
  if (!packs.length) return { applied: false, reason: "no override packs" };

  const dataDir = path.join(publishDir, "data");
  const windowPath = WINDOW_FILES.map((f) => path.join(dataDir, f)).find((p) => fs.existsSync(p));
  const windowPayload = windowPath ? readJson(windowPath) : null;
  if (!windowPayload) return { applied: false, reason: "no 30-day packs file" };

  const month = windowMonth(windowPayload);
  if (config.issue_month && month !== config.issue_month) {
    return {
      applied: false,
      reason: `window month ${month || "unknown"} != overrides issue_month ${config.issue_month}`,
    };
  }

  const windowPacks = config.replace_window_packs
    ? packs
    : mergeByTitle(windowPayload.packs || [], packs);
  const nextWindow = {
    ...windowPayload,
    packs: windowPacks,
    pack_count: windowPacks.length,
    ...(config.provenance ? { provenance: config.provenance } : {}),
  };
  for (const f of WINDOW_FILES) writeJson(path.join(dataDir, f), nextWindow);

  const fullPath = FULL_FILES.map((f) => path.join(dataDir, f)).find((p) => fs.existsSync(p));
  const fullPayload = fullPath ? readJson(fullPath) : null;
  if (fullPayload && Array.isArray(fullPayload.packs)) {
    const merged = mergeByTitle(fullPayload.packs, packs);
    const nextFull = { ...fullPayload, packs: merged, pack_count: merged.length };
    for (const f of FULL_FILES) writeJson(path.join(dataDir, f), nextFull);
  }

  return { applied: true, month, window_packs: windowPacks.length };
}

module.exports = { applyOverrides, windowMonth, mergeByTitle };

if (require.main === module) {
  const publishDir = process.argv[2] || path.join(__dirname, "..", "publish");
  const result = applyOverrides(publishDir, process.argv[3] || DEFAULT_OVERRIDES);
  console.log(
    result.applied
      ? `Evidence-pack overrides applied for ${result.month} (${result.window_packs} window packs).`
      : `Evidence-pack overrides skipped: ${result.reason}.`
  );
}
