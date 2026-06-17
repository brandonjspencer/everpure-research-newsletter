"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { CLASSIC_ROUTES } = require("../netlify/build_api_endpoints");

// Regression guard: the classic endpoints the old homepage advertised must all
// be pre-rendered as static JSON for GitHub Pages. (The actual render is exercised
// by the live build, which invokes the real api.js handler.)
test("classic API endpoints cover the legacy homepage routes", () => {
  const legacy = [
    "health",
    "metadata",
    "weeks",
    "findings",
    "summary",
    "decks",
    "deck-summary",
    "deck-details",
    "deck-content",
  ];
  for (const route of legacy) {
    assert.ok(CLASSIC_ROUTES.includes(route), `missing classic endpoint: ${route}`);
  }
});
