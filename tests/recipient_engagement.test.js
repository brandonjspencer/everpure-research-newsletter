"use strict";

// The private engagement reports in appsscript/Code.gs — buildRecipientEngagement() and
// buildEngagementSummary() — run in a sandbox with a fake spreadsheet and fake GA4 Data API
// responses: EmailEvents (sent rows + legacy Web App clicks) merged with GA4 opens/clicks, only
// for (token, issue) pairs that were actually sent, with hostile inputs defused.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const CODE = fs.readFileSync(path.join(__dirname, "..", "appsscript", "Code.gs"), "utf8");
const SITE = "https://brandonjspencer.github.io/everpure-research-newsletter";
const issueUrl = (q) =>
  `${SITE}/issues/2026-10/default.html?utm_source=email&utm_medium=email&utm_campaign=issue-2026-10&${q}`;

function fakeSheet(values = []) {
  const sheet = {
    values: values.map((r) => r.slice()),
    formats: [],
    getDataRange: () => ({ getValues: () => sheet.values.map((r) => r.slice()) }),
    appendRow: (r) => sheet.values.push(r.slice()),
    clearContents: () => {
      sheet.values = [];
    },
    getRange: (row, col, nr = 1, nc = 1) => ({
      setNumberFormat: (f) => sheet.formats.push({ row, col, nr, nc, f }),
      setValue: (v) => {
        sheet.values[row - 1] = sheet.values[row - 1] || [];
        sheet.values[row - 1][col - 1] = v;
      },
      setValues: (vals) => {
        assert.strictEqual(vals.length, nr);
        vals.forEach((r, i) => {
          assert.strictEqual(r.length, nc);
          sheet.values[row - 1 + i] = sheet.values[row - 1 + i] || [];
          r.forEach((v, j) => (sheet.values[row - 1 + i][col - 1 + j] = v));
        });
      },
    }),
    setFrozenRows: (n) => (sheet.frozen = n),
  };
  return sheet;
}

function sandbox({ props = {}, tabs = {}, gaRows = [] } = {}) {
  const sheets = {};
  const gaCalls = [];
  const ctx = {
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }),
    },
    Logger: { log: () => {} },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => (sheets[n] = fakeSheet()),
      }),
    },
    AnalyticsData: {
      Properties: {
        runReport: (req, property) => {
          gaCalls.push({ req, property });
          const page = gaRows.slice(req.offset, req.offset + req.limit);
          return {
            rowCount: gaRows.length,
            rows: page.length
              ? page.map(([event, loc, date, count]) => ({
                  dimensionValues: [{ value: event }, { value: loc }, { value: date }],
                  metricValues: [{ value: String(count) }],
                }))
              : undefined,
          };
        },
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  // Sheets hands Apps Script Date objects from its own runtime, so `instanceof Date` holds there;
  // rebuild fixture dates inside the sandbox to match.
  const own = (v) => (v instanceof Date ? vm.runInContext(`new Date(${v.getTime()})`, ctx) : v);
  Object.entries(tabs).forEach(
    ([name, values]) => (sheets[name] = fakeSheet(values.map((r) => r.map(own))))
  );
  return { ctx, sheets, gaCalls };
}

const RECIPIENTS = [
  ["email", "active", "token", "name"],
  ["alice@example.com", true, "tok-a", "Alice A"],
  ["bob@example.com", "yes", "tok-b", "Bob B"],
  ["carol@example.com", false, "tok-c", "=Carol"],
  ["dave@example.com", true, "", "Dave (no token yet)"],
];
const EVENTS = [
  ["timestamp", "event", "token", "issue", "link"],
  // Sheets coerces a written "2026-09" into a Date — normalizeIssueCell_ must undo it
  [new Date(2026, 8, 24), "sent", "tok-a", new Date(2026, 8, 1), ""],
  [new Date(2026, 8, 24), "sent", "tok-b", "2026-09", ""],
  [new Date(2026, 8, 25, 10), "click", "tok-a", "2026-09", "hero-read-issue"], // legacy Web App click
  [new Date(2026, 9, 16), "sent", "tok-a", "2026-10", ""],
  [new Date(2026, 9, 16), "sent", "tok-b", "2026-10", ""],
  [new Date(2026, 9, 16), "sent", "tok-c", "2026-10", ""],
  [new Date(2026, 9, 16), "sent", "constructor", "2026-10", ""], // a real send to a since-removed row
  [new Date(2026, 9, 16), "sent", "test-uuid-1", "2026-10", ""], // reviewer test send
];
const GA = [
  ["email_open", `${SITE}/email/2026-10/open?rid=tok-b`, "20261017", 1],
  ["page_view", issueUrl("utm_content=video-play&rid=tok-a"), "20261017", 2],
  ["page_view", issueUrl("utm_content=hero-read-issue&rid=tok-a"), "20261018", 1],
  ["email_open", `${SITE}/email/2026-10/open?rid=test-uuid-1`, "20261016", 1], // test send
  ["page_view", issueUrl("utm_content=%3DIMPORTDATA(%22x%22)&rid=tok-c"), "20261017", 1], // crafted link id
  ["page_view", issueUrl("utm_content=video-play&rid=tok-zzz"), "20261017", 9], // made-up token, never sent
  ["email_open", `${SITE}/email/2026-08/open?rid=tok-b`, "20261017", 1], // an issue never sent to bob
  ["page_view", `${SITE}/trends/?rid=tok-a`, "20261017", 1], // not an issue page
  ["page_view", issueUrl("rid=__proto__"), "20261017", 1], // invalid token shape
];

function run() {
  const env = sandbox({
    props: { RECIPIENTS_SHEET_ID: "sheet", GA_PROPERTY_ID: "123456789" },
    tabs: { Recipients: RECIPIENTS, EmailEvents: EVENTS },
    gaRows: GA,
  });
  const result = env.ctx.buildRecipientEngagement();
  const table = (name) => {
    const [header, ...rows] = env.sheets[name].values;
    return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
  };
  return { env, result, people: table("RecipientEngagement"), summary: table("EngagementSummary") };
}

test("parseEmailHit_ reads opens and clicks and rejects anything off-shape", () => {
  const { ctx } = sandbox();
  const hit = (e, u) => JSON.parse(JSON.stringify(ctx.parseEmailHit_(e, u)));
  assert.deepStrictEqual(hit("email_open", `${SITE}/email/2026-10/open?rid=tok-b`), {
    kind: "open",
    token: "tok-b",
    issue: "2026-10",
    link: "",
  });
  assert.deepStrictEqual(hit("page_view", issueUrl("utm_content=video-play&rid=tok-a") + "#x"), {
    kind: "click",
    token: "tok-a",
    issue: "2026-10",
    link: "video-play",
  });
  assert.strictEqual(hit("page_view", issueUrl("utm_content=%3D1%2B1&rid=tok-a")).link, "");
  assert.strictEqual(ctx.parseEmailHit_("page_view", issueUrl("rid=__proto__")), null);
  assert.strictEqual(ctx.parseEmailHit_("page_view", `${SITE}/trends/?rid=tok-a`), null);
  assert.strictEqual(ctx.parseEmailHit_("email_open", issueUrl("rid=tok-a")), null);
  assert.strictEqual(ctx.parseEmailHit_("page_view", issueUrl("rid=%E0%A4%A")), null);
});

test("GA4 is queried for rid-tagged opens and page views on the configured property", () => {
  const { env } = run();
  assert.strictEqual(env.gaCalls.length, 1);
  const { req, property } = env.gaCalls[0];
  assert.strictEqual(property, "properties/123456789");
  assert.strictEqual(req.dateRanges[0].startDate, "2026-10-01");
  const filters = req.dimensionFilter.andGroup.expressions.map((x) => x.filter);
  assert.deepStrictEqual([...filters[0].inListFilter.values], ["email_open", "page_view"]);
  assert.strictEqual(filters[1].stringFilter.value, "rid=");
});

test("RecipientEngagement: one row per sent-to recipient, merged across sources", () => {
  const { people, result, env } = run();
  assert.deepStrictEqual(
    people.map((p) => p.email),
    ["alice@example.com", "carol@example.com", "bob@example.com"] // click rate, then open rate, then email
  );
  const [alice, carol, bob] = people;
  assert.strictEqual(alice.name, "Alice A");
  assert.strictEqual(alice.issues_received, 2);
  assert.strictEqual(alice.issues_opened, 2); // clicks count as opens
  assert.strictEqual(alice.issues_clicked, 2);
  assert.strictEqual(alice.click_rate, 1);
  assert.strictEqual(alice.last_seen, "2026-10-18");
  assert.strictEqual(alice.links_clicked, "hero-read-issue ×2, video-play ×2");
  assert.strictEqual(alice["2026-10"], "clicked");
  assert.strictEqual(alice["2026-09"], "clicked");

  assert.strictEqual(bob.issues_received, 2);
  assert.strictEqual(bob.issues_opened, 1);
  assert.strictEqual(bob.open_rate, 0.5);
  assert.strictEqual(bob.click_rate, 0);
  assert.strictEqual(bob["2026-10"], "opened");
  assert.strictEqual(bob["2026-09"], "not opened");

  assert.strictEqual(carol.name, "'=Carol"); // formula defused
  assert.strictEqual(carol.active, "no");
  assert.strictEqual(carol.links_clicked, ""); // crafted link id dropped
  assert.strictEqual(carol["2026-09"], ""); // never sent

  assert.strictEqual(result.unmatched, 1); // "constructor": sent, but no Recipients row now
  const header = env.sheets.RecipientEngagement.values[0];
  assert.deepStrictEqual(header.slice(-2), ["2026-10", "2026-09"]); // newest issue first
  const text = env.sheets.RecipientEngagement.formats.filter((f) => f.f === "@");
  assert.ok(
    text.some((f) => f.row === 1 && f.nc === header.length),
    "header row pinned to text"
  );
  const all = env.sheets.RecipientEngagement.values.flat();
  assert.ok(!all.some((v) => typeof v === "string" && /^[=+\-@]/.test(v)), "no live formulas");
  assert.ok(!all.some((v) => typeof v === "string" && v.startsWith("test-")));
});

test("EngagementSummary: per-issue totals from sent rows only, test sends and made-up tokens excluded", () => {
  const { summary } = run();
  assert.deepStrictEqual(
    summary.map((s) => [s.issue, s.recipients, s.unique_opens, s.unique_clicks, s.top_link]),
    [
      ["2026-09", 2, 1, 1, "hero-read-issue"],
      ["2026-10", 4, 3, 2, "video-play"],
    ]
  );
  assert.strictEqual(summary[1].open_rate, 0.75);
});

test("without GA_PROPERTY_ID the reports still build from EmailEvents alone", () => {
  const env = sandbox({
    props: { RECIPIENTS_SHEET_ID: "sheet" },
    tabs: { Recipients: RECIPIENTS, EmailEvents: EVENTS },
  });
  env.ctx.buildEngagementSummary();
  assert.strictEqual(env.gaCalls.length, 0);
  const [, sep, oct] = env.sheets.EngagementSummary.values;
  assert.deepStrictEqual(sep.slice(0, 4), ["2026-09", 2, 1, 1]);
  assert.deepStrictEqual(oct.slice(0, 4), ["2026-10", 4, 0, 0]);
});
