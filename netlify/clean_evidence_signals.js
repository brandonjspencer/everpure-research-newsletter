#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = process.argv[2] || path.resolve(process.cwd(), "publish");
const dataDir = path.join(root, "data");

const files = [
  "evidence_packs.json",
  "evidence-packs.json",
  "evidence_packs_default_30d.json",
  "evidence-packs-default-30d.json",
];

const BOILERPLATE_PATTERNS = [
  /UX Metrics/i,
  /Frequency Audiences/i,
  /Technical leader/i,
  /AI Infrastructure and Technical Leaders/i,
  /Infrastructure Owner/i,
  /Front-end & Full Stack Developers/i,
  /Global\)/i,
  /US, UK, GR & FR/i,
  /Expectations/i,
  /Satisfaction/i,
  /Intent/i,
  /^●/,
  /^…$/,
];

const EVIDENCE_PATTERNS = [
  /\b\d{1,3}%\b/,
  /\b\d+(?:\.\d+)?x\b/i,
  /\b(increase|decrease|drop|dropped|lift|uplift|improved|improvement|decline|reduced|reduction)\b/i,
  /\b(comprehension|sentiment|engagement|conversion|success|effort|clarity|clearer|credible|credibility|preference|preferred)\b/i,
  /\b(v1|v2|r2|r3|baseline|variation|compare|comparison|winner|winning)\b/i,
];

function isBoilerplate(s) {
  const t = (s || "").trim();
  if (!t) return true;
  if (t.length < 12) return true;
  if (BOILERPLATE_PATTERNS.some(rx => rx.test(t))) return true;
  const bulletish = (t.match(/●/g) || []).length;
  if (bulletish >= 3) return true;
  return false;
}

function scoreSignal(s) {
  let score = 0;
  for (const rx of EVIDENCE_PATTERNS) if (rx.test(s)) score += 2;
  if (/\b\d{1,3}%\b/.test(s)) score += 3;
  if (/\b(from|to)\b/i.test(s) && /\b\d{1,3}%\b/.test(s)) score += 2;
  if (/\b(should|recommend|next|iterate|ship|retest|hold)\b/i.test(s)) score += 1;
  return score;
}

function normalize(arr) {
  const seen = new Set();
  const out = [];
  for (const raw of (arr || [])) {
    const s = String(raw || "").replace(/\s+/g, " ").trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

function cleanPack(pack) {
  const sourceSignals = normalize([
    ...(pack.supporting_signals || []),
    ...(pack.key_synthesis_signals || []),
    ...(pack.raw_finding_excerpts || []),
  ]);

  const strong = sourceSignals
    .filter(s => !isBoilerplate(s))
    .map(s => ({ s, score: scoreSignal(s) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.s);

  const cleanSignals = strong.slice(0, 6);

  const cleanKeyNumbers = cleanSignals.filter(s => /\b\d{1,3}%\b/.test(s) || /\b\d+(?:\.\d+)?x\b/i.test(s)).slice(0, 3);

  pack.clean_supporting_signals = cleanSignals;
  pack.clean_key_numbers = cleanKeyNumbers;

  if (!pack.clean_supporting_signals.length && sourceSignals.length) {
    pack.clean_supporting_signals = sourceSignals.filter(s => !isBoilerplate(s)).slice(0, 3);
  }

  if (!pack.next_step_from_clean_evidence) {
    if ((pack.rule_based_status || "").toLowerCase().includes("iterate")) {
      pack.next_step_from_clean_evidence = "Use the strongest surviving variant or message direction to define one tighter follow-up test before rollout.";
    } else if ((pack.rule_based_status || "").toLowerCase().includes("ship")) {
      pack.next_step_from_clean_evidence = "Ship the current direction and monitor the primary success metric after launch.";
    } else {
      pack.next_step_from_clean_evidence = pack.rule_based_next_step || "Use the current evidence to narrow the next round rather than broaden the scope.";
    }
  }

  return pack;
}

for (const name of files) {
  const fp = path.join(dataDir, name);
  if (!fs.existsSync(fp)) continue;
  try {
    const data = JSON.parse(fs.readFileSync(fp, "utf8"));
    const cleaned = Array.isArray(data) ? data.map(cleanPack) : data;
    fs.writeFileSync(fp, JSON.stringify(cleaned, null, 2));
    console.log(`Cleaned ${name}`);
  } catch (err) {
    console.error(`Failed ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}
