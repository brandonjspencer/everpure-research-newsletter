"use strict";

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const { render, monthLabel, pct, rate } = require("../netlify/render_analytics_dashboard");

test("pct and rate format aggregate percentages without per-recipient detail", () => {
  assert.strictEqual(rate(0, 0), 0);
  assert.strictEqual(rate(5, 10), 0.5);
  assert.strictEqual(pct(0.5), "50%");
  assert.strictEqual(pct(0.4567), "45.7%");
});

test("monthLabel formats YYYY-MM as a readable month", () => {
  assert.strictEqual(monthLabel("2026-08"), "August 2026");
  assert.strictEqual(monthLabel(""), "");
});

test("render shows a friendly empty state when no issues are curated yet", () => {
  const html = render({ issues: [] }, "");
  assert.match(html, /No engagement data yet/);
  assert.doesNotMatch(html, /<table/);
});

test("render shows aggregate rates and a top link per issue, never a recipient name/email", () => {
  const html = render(
    {
      issues: [
        {
          month: "2026-08",
          issue_number: "05",
          recipients: 50,
          unique_opens: 40,
          unique_clicks: 20,
          top_link: "Read Full Roundup",
        },
      ],
    },
    ""
  );
  assert.match(html, /August 2026/);
  assert.match(html, /Issue 05/);
  assert.match(html, /80%/); // open rate
  assert.match(html, /40%/); // click rate
  assert.match(html, /Read Full Roundup/);
  // The whole point of this page is aggregate-only - it must never carry an
  // email address (the shared theme's CSS legitimately uses bare "@" for
  // @media/@import, so check for an actual email pattern, not the character).
  assert.doesNotMatch(html, /[^\s"'<>]+@[^\s"'<>]+\.[a-z]{2,}/i);
});

test("render replaces an email accidentally pasted into top_link rather than publishing it", () => {
  const html = render(
    {
      issues: [
        {
          month: "2026-08",
          recipients: 50,
          unique_opens: 40,
          unique_clicks: 20,
          top_link: "jane.doe@example.com",
        },
      ],
    },
    ""
  );
  assert.doesNotMatch(html, /jane\.doe@example\.com/);
  assert.match(html, />—<\/td>/); // falls back to the empty-value dash
});

test("render sorts issues newest-first", () => {
  const html = render(
    {
      issues: [
        { month: "2026-06", recipients: 1, unique_opens: 1, unique_clicks: 0 },
        { month: "2026-08", recipients: 1, unique_opens: 1, unique_clicks: 0 },
        { month: "2026-07", recipients: 1, unique_opens: 1, unique_clicks: 0 },
      ],
    },
    ""
  );
  const positions = ["August 2026", "July 2026", "June 2026"].map((label) => html.indexOf(label));
  assert.ok(positions[0] < positions[1] && positions[1] < positions[2]);
});

test("password gate: content is hidden until the embedded hash matches", () => {
  const password = "correct horse battery staple";
  const hashHex = crypto.createHash("sha256").update(password).digest("hex");
  const html = render({ issues: [] }, hashHex);
  assert.match(html, /id="eg-gate"/);
  assert.match(html, /id="eg-content" style="display:none"/);
  assert.match(
    html,
    new RegExp(`HASH=${JSON.stringify(hashHex)}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );
});

test("password gate: an empty/unset hash can never be satisfied by any input", () => {
  const html = render({ issues: [] }, "");
  assert.match(html, /HASH=""/);
});
