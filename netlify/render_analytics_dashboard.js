#!/usr/bin/env node
/**
 * Render the public Analytics page: aggregate (never per-recipient) email
 * engagement per issue - unique opens/clicks, rates, top link - sourced from
 * the committed, monthly-curated netlify/content/email_engagement.json (the
 * same "data, not code" pattern as ux_signals.json/voice_of_user.json).
 *
 * Per-recipient "who opened/clicked" detail lives only in the private
 * Apps-Script-side EngagementSummary/EmailEvents sheets - never here. This
 * page also sits behind a client-side password gate (see gateScript() below):
 * GitHub Pages has no server-side auth, so the gate is a deterrent against
 * casual browsing, not real access control - anyone who opens devtools can
 * still read the embedded (aggregate-only) JSON. That's an intentional
 * trade-off, not an oversight: keeping identifiable data out of this page
 * entirely is what actually protects it.
 *
 * Run: node netlify/render_analytics_dashboard.js <repo-root>
 */
const fs = require("fs");
const path = require("path");
const { docHead, sidebar } = require("./dashboard_theme");

function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function pct(n) {
  return `${Math.round(n * 1000) / 10}%`;
}

function rate(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function monthLabel(month) {
  const m = String(month || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return month || "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function bar(value, colorVar) {
  const width = Math.max(0, Math.min(100, Math.round(value * 100)));
  return `<div class="eg-track"><div class="eg-fill" style="width:${width}%;background:var(${colorVar})"></div></div>`;
}

// This field is free-text, hand-transcribed monthly from the private
// EngagementSummary sheet (see appsscript/README.md "Engagement tracking") —
// unlike the numeric fields above, nothing coerces it away from accidentally
// carrying a pasted-in recipient email/name. Fail closed rather than publish
// it verbatim if it ever looks identifying.
const EMAIL_LIKE = /[^\s"'<>]+@[^\s"'<>]+\.[a-z]{2,}/i;
function safeTopLink(value) {
  const s = String(value || "").trim();
  return s && !EMAIL_LIKE.test(s) ? s : "—";
}

function issueRow(issue) {
  const recipients = Number(issue.recipients) || 0;
  const opens = Number(issue.unique_opens) || 0;
  const clicks = Number(issue.unique_clicks) || 0;
  const openRate = rate(opens, recipients);
  const clickRate = rate(clicks, recipients);
  return `<tr>
  <td class="eg-month">${esc(monthLabel(issue.month))}${issue.issue_number ? ` <span class="eg-issue-num">Issue ${esc(issue.issue_number)}</span>` : ""}</td>
  <td>${recipients}</td>
  <td>${opens} <span class="eg-rate">(${pct(openRate)})</span>${bar(openRate, "--bar-variant")}</td>
  <td>${clicks} <span class="eg-rate">(${pct(clickRate)})</span>${bar(clickRate, "--bar-base")}</td>
  <td>${esc(safeTopLink(issue.top_link))}</td>
</tr>`;
}

function emptyState() {
  return `<div class="card eg-empty">No engagement data yet — this starts once the next issue is sent with tracking enabled.</div>`;
}

// Client-side password gate. See the file header for why this is a deterrent,
// not real access control: PASSWORD_HASH_HEX is a SHA-256 hex digest baked in
// at build time from the ANALYTICS_DASHBOARD_PASSWORD_HASH secret (never the
// plaintext). An empty/placeholder hash can never match any real input, so
// the gate safely stays locked until a real hash is configured.
function gateScript(passwordHashHex) {
  const hash = JSON.stringify(String(passwordHashHex || ""));
  return `<script>(function(){
  var HASH=${hash};
  var gate=document.getElementById('eg-gate'), content=document.getElementById('eg-content'),
      form=document.getElementById('eg-gate-form'), input=document.getElementById('eg-gate-input'),
      err=document.getElementById('eg-gate-error');
  async function sha256Hex(str){
    var buf=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.prototype.map.call(new Uint8Array(buf), function(b){return b.toString(16).padStart(2,'0');}).join('');
  }
  if(!form) return;
  form.addEventListener('submit', function(e){
    e.preventDefault();
    if(!HASH){ err.textContent='This dashboard is not configured yet.'; err.style.display='block'; return; }
    if(!(window.crypto && window.crypto.subtle)){ err.textContent='This browser cannot verify the password (requires HTTPS).'; err.style.display='block'; return; }
    sha256Hex(input.value).then(function(hex){
      if(hex===HASH){ gate.style.display='none'; content.style.display=''; }
      else { err.textContent='Incorrect password.'; err.style.display='block'; input.value=''; input.focus(); }
    });
  });
})();</script>`;
}

function render(data, passwordHashHex) {
  const issues = Array.isArray(data.issues) ? data.issues.slice() : [];
  issues.sort((a, b) => String(b.month || "").localeCompare(String(a.month || "")));
  const totalOpens = issues.reduce((sum, i) => sum + (Number(i.unique_opens) || 0), 0);
  const totalClicks = issues.reduce((sum, i) => sum + (Number(i.unique_clicks) || 0), 0);
  const avgOpenRate = issues.length
    ? issues.reduce(
        (sum, i) => sum + rate(Number(i.unique_opens) || 0, Number(i.recipients) || 0),
        0
      ) / issues.length
    : 0;
  const avgClickRate = issues.length
    ? issues.reduce(
        (sum, i) => sum + rate(Number(i.unique_clicks) || 0, Number(i.recipients) || 0),
        0
      ) / issues.length
    : 0;

  const kpis = [
    ["Issues tracked", String(issues.length)],
    ["Avg. open rate", issues.length ? pct(avgOpenRate) : "—"],
    ["Avg. click rate", issues.length ? pct(avgClickRate) : "—"],
    ["Total opens / clicks", `${totalOpens} / ${totalClicks}`],
  ]
    .map(
      ([label, v]) =>
        `<div class="kpi"><div class="kpi-v">${esc(v)}</div><div class="kpi-l">${esc(label)}</div></div>`
    )
    .join("");

  const table = issues.length
    ? `<div class="card eg-table-card"><table class="eg-table">
  <thead><tr><th>Issue</th><th>Recipients</th><th>Unique opens</th><th>Unique clicks</th><th>Top link</th></tr></thead>
  <tbody>${issues.map(issueRow).join("")}</tbody>
</table></div>`
    : emptyState();

  return `<!doctype html>
<html lang="en"><head>
${docHead("Everpure Research — Analytics")}
<style>
  .eg-table-card{padding:0;overflow:hidden}
  .eg-table{width:100%;border-collapse:collapse;font-size:14px}
  .eg-table th,.eg-table td{padding:12px 16px;text-align:left;border-bottom:1px solid var(--line)}
  .eg-table th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}
  .eg-table tr:last-child td{border-bottom:none}
  .eg-month{font-weight:600}
  .eg-issue-num{font-weight:400;color:var(--muted);font-size:12px}
  .eg-rate{color:var(--muted);font-size:12px}
  .eg-track{height:5px;background:var(--track);border-radius:3px;margin-top:5px;max-width:160px}
  .eg-fill{height:100%;border-radius:3px}
  .eg-empty{color:var(--muted);text-align:center;padding:32px 16px}
  .eg-gate{max-width:360px;margin:48px auto;text-align:center}
  .eg-gate label{display:block;font-size:13px;color:var(--muted);margin-bottom:8px}
  .eg-gate input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font-size:14px;margin-bottom:10px}
  .eg-gate-error{color:var(--c-low);font-size:13px;display:none;margin-top:8px}
</style>
</head>
<body>
${sidebar("analytics", "../")}
<div class="shell"><div class="wrap">
<header>
  <h1>Analytics</h1>
  <p class="sub">Aggregate engagement for the Research Roundup email and site. No per-recipient detail is shown here — see the private engagement sheet for who specifically opened or clicked.</p>
</header>

<div id="eg-gate" class="eg-gate">
  <form id="eg-gate-form">
    <label for="eg-gate-input">This page is password-protected</label>
    <input id="eg-gate-input" type="password" autocomplete="off" placeholder="Password" />
    <button type="submit" class="btn">Unlock</button>
    <p id="eg-gate-error" class="eg-gate-error"></p>
  </form>
</div>

<div id="eg-content" style="display:none">
  <div class="kpis">${kpis}</div>
  ${table}
</div>

<footer>
  Source: <code>netlify/content/email_engagement.json</code>, re-curated after each monthly send from the Apps Script engagement summary.
</footer>
</div></div>
${gateScript(passwordHashHex)}
</body></html>`;
}

function main() {
  const root = path.resolve(process.argv[2] || ".");
  const data = readJson(path.join(root, "netlify", "content", "email_engagement.json"), {
    issues: [],
  });
  const outDir = path.join(root, "publish", "analytics");
  fs.mkdirSync(outDir, { recursive: true });
  const passwordHashHex = process.env.ANALYTICS_DASHBOARD_PASSWORD_HASH || "";
  fs.writeFileSync(path.join(outDir, "index.html"), render(data, passwordHashHex), "utf8");
  console.log(`Wrote ${path.join(outDir, "index.html")}`);
}

if (require.main === module) main();

module.exports = { render, issueRow, monthLabel, pct, rate };
