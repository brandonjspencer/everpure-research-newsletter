#!/usr/bin/env node
/**
 * Pre-render the "classic" API endpoints as static JSON for GitHub Pages.
 *
 * netlify/api.js's handler defines routes (/api/health, /api/metadata, /api/weeks,
 * /api/findings, /api/summary, /api/decks, /api/deck-summary, /api/deck-details,
 * /api/deck-content, /api/static-summary) that only ran on a live serverless host.
 * On static Pages they 404. This invokes the SAME handler at build time and writes
 * each route's response to publish/api/<route>.json, so the endpoints are real,
 * always match the handler, and get listed in the sitemap.
 *
 * Filtered routes (e.g. /api/weeks?since=) can't be query-driven on a static host,
 * so we emit the unfiltered full payload — the same default the old links hit.
 *
 * Run: node netlify/build_api_endpoints.js   (cwd must be repo root — api.js reads
 * publish/data relative to process.cwd(), which netlify/build.sh guarantees).
 */
const fs = require("fs");
const path = require("path");
const { handler } = require("./api.js");

const ROOT = path.join(__dirname, "..");
const API_DIR = path.join(ROOT, "publish", "api");

// The endpoints the old homepage advertised, plus static-summary. Newsletter +
// status endpoints are already written by generate_static_newsletters.js.
const CLASSIC_ROUTES = [
  "health",
  "metadata",
  "weeks",
  "findings",
  "summary",
  "decks",
  "deck-summary",
  "deck-details",
  "deck-content",
  "static-summary",
];

async function callRoute(route) {
  const event = {
    path: `/api/${route}`,
    rawPath: `/api/${route}`,
    rawUrl: `https://example.com/api/${route}`,
    headers: { host: "example.com", "x-forwarded-proto": "https" },
    queryStringParameters: {},
  };
  return handler(event, { params: { splat: route } });
}

function writeBody(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf8");
}

async function writeEndpoints() {
  fs.mkdirSync(API_DIR, { recursive: true });
  const written = [];
  for (const route of CLASSIC_ROUTES) {
    try {
      const res = await callRoute(route);
      if (res && res.statusCode === 200 && typeof res.body === "string") {
        writeBody(path.join(API_DIR, `${route}.json`), res.body);
        written.push(`api/${route}.json`);
      }
    } catch {
      // non-blocking: a missing data file just skips that endpoint
    }
  }
  // Per-deck detail pages (the parameterized /api/deck-details/{file_id} route).
  try {
    const idx = await callRoute("deck-details");
    const rows = JSON.parse(idx.body);
    const list = Array.isArray(rows) ? rows : rows.items || rows.decks || [];
    for (const deck of list) {
      const fileId = deck && deck.file_id;
      if (!fileId) continue;
      const res = await callRoute(`deck-details/${fileId}`);
      if (res && res.statusCode === 200 && typeof res.body === "string") {
        writeBody(path.join(API_DIR, "deck-details", `${fileId}.json`), res.body);
        written.push(`api/deck-details/${fileId}.json`);
      }
    }
  } catch {
    // index unavailable — skip per-deck details
  }
  return written;
}

async function main() {
  const written = await writeEndpoints();
  console.log(
    JSON.stringify({ classic_endpoints_written: written.length, files: written }, null, 2)
  );
}

if (require.main === module) main();

module.exports = { CLASSIC_ROUTES, callRoute, writeEndpoints };
