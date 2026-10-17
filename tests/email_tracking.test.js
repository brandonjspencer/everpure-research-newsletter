"use strict";

// The Apps Script sender (appsscript/Code.gs) run in a sandbox with stubbed Google services, against
// the real October 2026 email — GA4 tracking mode: links keep their real destination plus rid +
// utm_content, opens are a GA4 collection hit, and nothing routes through the Web App.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const CODE = fs.readFileSync(path.join(ROOT, "appsscript", "Code.gs"), "utf8");
const EMAIL = fs.readFileSync(
  path.join(ROOT, "emails", "research_roundup_issue07_email_october2026.html"),
  "utf8"
);
const ISSUE_URL =
  "https://brandonjspencer.github.io/everpure-research-newsletter/issues/2026-10/default.html";
const GA_ID = "G-TEST123";

function sandbox(props = {}) {
  const sent = [];
  const logs = [];
  const rows = [];
  const sheet = {
    appendRow: (r) => rows.push(r),
    getDataRange: () => ({ getValues: () => [] }),
    getRange: () => ({ setValue: () => {} }),
  };
  const ctx = {
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }),
    },
    Logger: { log: (...a) => logs.push(a) },
    Utilities: { getUuid: () => "uuid-1", sleep: () => {} },
    MailApp: { getRemainingDailyQuota: () => 1500, sendEmail: (m) => sent.push(m) },
    DriveApp: { getFileById: () => ({ getBlob: () => ({ getDataAsString: () => EMAIL }) }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet }) },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return { ctx, sent, logs, rows };
}

const trackedIds = [...EMAIL.matchAll(/data-track-id="([^"]+)"/g)].map((m) => m[1]);
const hrefs = (html) =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
const pixelSrc = (html) => {
  const m = /<img src="([^"]*)" width="1" height="1"[^>]*\/><\/body>/.exec(html);
  return m ? new URL(m[1].replace(/&amp;/g, "&")) : null;
};

test("withQueryParams_ adds or replaces params and keeps the fragment last", () => {
  const { ctx } = sandbox();
  assert.strictEqual(ctx.withQueryParams_("https://x.test/a", { b: "1" }), "https://x.test/a?b=1");
  assert.strictEqual(
    ctx.withQueryParams_("https://x.test/a?utm_content=old&c=2#frag", { utm_content: "new id" }),
    "https://x.test/a?c=2&utm_content=new%20id#frag"
  );
});

test("trackingMode_: GA4 wins over the Web App; off when neither is set", () => {
  assert.strictEqual(sandbox().ctx.trackingMode_(), "");
  assert.strictEqual(
    sandbox({ TRACKING_BASE_URL: "https://s/exec" }).ctx.trackingMode_(),
    "webapp"
  );
  assert.strictEqual(
    sandbox({ TRACKING_BASE_URL: "https://s/exec", GA_MEASUREMENT_ID: GA_ID }).ctx.trackingMode_(),
    "ga"
  );
});

test("personalizeGaHtml_ tags every tracked link and adds one GA4 open hit", () => {
  const { ctx } = sandbox();
  assert.strictEqual(trackedIds.length, 8);
  const out = ctx.personalizeGaHtml_(EMAIL, "tok-1", "2026-10", GA_ID, false, 1760000000000);

  assert.ok(!out.includes("script.google.com"), "nothing routes through the Web App");
  const tagged = hrefs(out).filter((h) => h.includes("rid="));
  assert.strictEqual(tagged.length, trackedIds.length);
  tagged.forEach((h, i) => {
    const u = new URL(h);
    assert.ok(h.startsWith(ISSUE_URL + "?"), h);
    assert.strictEqual(u.searchParams.get("utm_campaign"), "issue-2026-10");
    assert.strictEqual(u.searchParams.get("utm_content"), trackedIds[i]);
    assert.strictEqual(u.searchParams.get("rid"), "tok-1");
  });
  // index links keep their section anchor
  assert.ok(tagged.some((h) => h.endsWith("&rid=tok-1#research-findings")));
  // untracked links are untouched
  assert.ok(out.includes('href="https://purestorage.enterprise.slack.com/archives/C03NSK4PCHJ"'));

  const px = pixelSrc(out);
  assert.ok(px, "pixel sits right before </body>");
  assert.strictEqual(px.origin + px.pathname, "https://www.google-analytics.com/g/collect");
  assert.strictEqual(px.searchParams.get("tid"), GA_ID);
  assert.strictEqual(px.searchParams.get("en"), "email_open");
  assert.strictEqual(px.searchParams.get("cid"), "tok-1");
  assert.strictEqual(px.searchParams.get("ep.issue_id"), "2026-10");
  assert.strictEqual(
    px.searchParams.get("dl"),
    "https://brandonjspencer.github.io/everpure-research-newsletter/email/2026-10/open?rid=tok-1"
  );
  assert.strictEqual(px.searchParams.get("_dbg"), null);
  assert.strictEqual(out.match(/google-analytics\.com/g).length, 1);
});

test("dry run reports GA4 mode and the tracked links without sending", () => {
  const { ctx, sent, logs } = sandbox({
    REPLY_TO: "me@example.com",
    REVIEWERS: "me@example.com",
    ISSUE_HTML_FILE_ID: "file",
    RECIPIENTS_SHEET_ID: "sheet",
    GA_MEASUREMENT_ID: GA_ID,
  });
  ctx.send_({ type: "issue", mode: "test", dryRun: true });
  const text = logs.map((a) => a.join(" | ")).join("\n");
  assert.strictEqual(sent.length, 0);
  assert.ok(text.includes("tracked via GA4 " + GA_ID), text);
  assert.ok(text.includes("2026-10 | 8 | " + trackedIds.join(", ")), text);
});

test("test send personalizes per reviewer, flags debug, and logs only 'sent'", () => {
  const { ctx, sent, rows } = sandbox({
    REPLY_TO: "me@example.com",
    REVIEWERS: "a@example.com, b@example.com",
    ISSUE_HTML_FILE_ID: "file",
    RECIPIENTS_SHEET_ID: "sheet",
    GA_MEASUREMENT_ID: GA_ID,
    TRACKING_BASE_URL: "https://script.google.com/macros/s/x/exec",
  });
  const result = ctx.send_({ type: "issue", mode: "test", dryRun: false });
  assert.strictEqual(result.trackingMode, "ga");
  assert.deepStrictEqual(
    sent.map((m) => m.to),
    ["a@example.com", "b@example.com"]
  );
  sent.forEach((m) => {
    assert.strictEqual(m.subject, "Everpure Research Roundup Newsletter — October 2026 Issue");
    assert.ok(!m.htmlBody.includes("script.google.com"));
    assert.strictEqual(pixelSrc(m.htmlBody).searchParams.get("_dbg"), "1");
    assert.strictEqual(pixelSrc(m.htmlBody).searchParams.get("cid"), "test-uuid-1");
  });
  // no TrackedLinks upsert in GA mode — only the two "sent" events
  assert.deepStrictEqual(
    rows.map((r) => r[1]),
    ["sent", "sent"]
  );
});
