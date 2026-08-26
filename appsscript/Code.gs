/**
 * Everpure email distribution — one consolidated, batched sender.
 *
 * Replaces three separate scripts (issue broadcast, test/review, ad-hoc UX-tip)
 * with one, parameterized by TYPE (issue | uxtip) × MODE (test | broadcast).
 *
 * Why this exists: the old issue/ux-tip scripts put every recipient into a
 * single message's BCC, which hits Gmail's per-message recipient limit (~50,
 * stricter with external addresses). On Google Workspace the *daily* quota is
 * ~1,500, so the fix is to send in batches instead of one giant BCC.
 *
 * All instance-specific values (spreadsheet id, HTML file ids, reviewers,
 * from/reply-to) live in Script Properties — NOT in this repo — so the PII
 * recipient list and Drive ids are never committed. See README.md.
 *
 * Run from the Apps Script editor or via `clasp run <fn>`:
 *   dryRunIssue           — log who would receive the issue (sends nothing)
 *   sendIssueTest         — issue email to REVIEWERS only
 *   sendIssueBroadcast    — issue email to the full active list (batched)
 *   dryRunUxTip / sendUxTipTest / sendUxTipBroadcast — same for a UX tip
 *
 * Engagement tracking (opens/clicks) is OPT-IN: it only activates once the
 * TRACKING_BASE_URL Script Property is set (the deployed Web App's /exec
 * URL — see README.md "Engagement tracking"). Until then, send_() behaves
 * exactly as before: one batched MailApp call per BATCH_SIZE recipients,
 * identical html for everyone. Once TRACKING_BASE_URL is set, send_() sends
 * ONE call per recipient instead, each with a personalized open pixel and
 * per-recipient tracked-link redirects — real per-recipient identity is the
 * whole point, which a shared batch body can't carry. See
 * ensureRecipientTokens() / doGet() / buildEngagementSummary() below.
 */

// ---- Config (defaults; override via Script Properties) ----------------------
var DEFAULTS = {
  RECIPIENTS_TAB: "Recipients",
  EMAIL_HEADER: "email",
  ACTIVE_HEADER: "active",
  TOKEN_HEADER: "token", // opaque per-recipient id for tracking (see ensureRecipientTokens)
  SUPPRESSION_TAB: "Unsubscribed", // optional tab with an "email" column to skip
  EVENTS_TAB: "EmailEvents", // tracking: one row per open/click event
  TRACKED_LINKS_TAB: "TrackedLinks", // tracking: link_id -> real url, per issue
  SUMMARY_TAB: "EngagementSummary", // tracking: aggregated per-issue stats
  BATCH_SIZE: "45", // recipients per message — under the per-message BCC limit
  BATCH_PAUSE_MS: "1200",
  FROM_NAME: "Everpure User Research Program",
};

// Property keys to set (see README.md):
//   Required: RECIPIENTS_SHEET_ID, REPLY_TO, REVIEWERS
//   Subject: read from the email HTML's <meta name="subject" content="…"> (preferred);
//     ISSUE_SUBJECT / UXTIP_SUBJECT are an OPTIONAL fallback for emails without the tag.
//   Email HTML source (per type, pick one):
//     - ISSUE_EMAIL_FOLDER_ID / UXTIP_EMAIL_FOLDER_ID  → auto-pick newest .html (recommended)
//     - ISSUE_HTML_FILE_ID / UXTIP_HTML_FILE_ID         → pin an exact file (overrides the folder)
//   Optional: ISSUE_HTML_PATTERN / UXTIP_HTML_PATTERN (name substring filter),
//             UNSUBSCRIBE_URL, TRACKING_BASE_URL (deployed Web App /exec URL — opt-in tracking)

function prop_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (v === null || v === "") v = DEFAULTS[key] || "";
  return v;
}

function requireProp_(key) {
  var v = prop_(key);
  if (!v) throw new Error("Missing Script Property: " + key + " (set it in Project Settings).");
  return v;
}

// ---- Public entry points ----------------------------------------------------
function dryRunIssue() {
  return send_({ type: "issue", mode: "broadcast", dryRun: true });
}
function sendIssueTest() {
  return send_({ type: "issue", mode: "test", dryRun: false });
}
function sendIssueBroadcast() {
  return send_({ type: "issue", mode: "broadcast", dryRun: false });
}
function dryRunUxTip() {
  return send_({ type: "uxtip", mode: "broadcast", dryRun: true });
}
function sendUxTipTest() {
  return send_({ type: "uxtip", mode: "test", dryRun: false });
}
function sendUxTipBroadcast() {
  return send_({ type: "uxtip", mode: "broadcast", dryRun: false });
}

// ---- Core -------------------------------------------------------------------
function send_(opts) {
  var type = opts.type;
  var mode = opts.mode;
  var dryRun = !!opts.dryRun;

  var replyTo = requireProp_("REPLY_TO");
  var fromName = prop_("FROM_NAME");

  // The subject rides inside the email: read <meta name="subject"> from the HTML so
  // there's no per-issue Script Property to bump. Fall back to ISSUE_SUBJECT /
  // UXTIP_SUBJECT for emails without the tag; error if neither is present.
  var rawHtml = resolveHtml_(type);
  var subject =
    subjectFromHtml_(rawHtml) || prop_(type === "issue" ? "ISSUE_SUBJECT" : "UXTIP_SUBJECT");
  if (!subject) {
    throw new Error(
      'No subject found: add <meta name="subject" content="…"> to the email HTML, or set ' +
        (type === "issue" ? "ISSUE_SUBJECT" : "UXTIP_SUBJECT") +
        " in Script Properties."
    );
  }
  Logger.log("Subject: %s", subject);

  var html = injectUnsubscribeFooter_(rawHtml, prop_("UNSUBSCRIBE_URL"));

  var recipients = mode === "test" ? reviewers_() : activeRecipients_();
  recipients = dedupeValid_(recipients);
  if (mode === "broadcast") {
    var suppressed = suppressedSet_();
    recipients = recipients.filter(function (r) {
      return !suppressed[r.email.toLowerCase()];
    });
  }

  if (!recipients.length) throw new Error("No recipients (" + type + "/" + mode + ").");

  // Daily quota is per-recipient regardless of batching.
  var remaining = MailApp.getRemainingDailyQuota();
  if (recipients.length > remaining) {
    throw new Error(
      "Daily email quota too low: need " + recipients.length + ", have " + remaining + "."
    );
  }

  var batchSize = Math.max(1, parseInt(prop_("BATCH_SIZE"), 10) || 45);
  var pauseMs = parseInt(prop_("BATCH_PAUSE_MS"), 10) || 1200;
  var trackingUrl = trackingBaseUrl_();

  if (dryRun) {
    var previewBatches = trackingUrl ? recipients.length : chunk_(recipients, batchSize).length;
    Logger.log(
      "[DRY RUN] %s/%s — %s recipient(s), %s, %s. Quota remaining: %s.",
      type,
      mode,
      recipients.length,
      trackingUrl
        ? "sent individually (tracking enabled)"
        : previewBatches + " batch(es) of " + batchSize,
      trackingUrl ? "tracked" : "untracked",
      remaining
    );
    Logger.log(
      "Sample: %s",
      recipients
        .slice(0, 5)
        .map(function (r) {
          return r.email;
        })
        .join(", ")
    );
    return { dryRun: true, recipients: recipients.length, batches: previewBatches };
  }

  // Tracking (opens/clicks) is opt-in: only activates once TRACKING_BASE_URL is
  // set. Real per-recipient identity needs a personalized body, which a shared
  // BCC batch can't carry, so this path sends one MailApp call per recipient.
  if (trackingUrl) {
    var issueId = issueIdFromHtml_(html) || type;
    var linkMap = extractTrackedLinks_(html);
    if (Object.keys(linkMap).length) saveTrackedLinks_(issueId, linkMap);
    var missingTokens = recipients.filter(function (r) {
      return !r.token;
    }).length;
    if (missingTokens) {
      Logger.log(
        "%s recipient(s) have no token yet — run ensureRecipientTokens() first; " +
          "sending to them this round without open/click tracking.",
        missingTokens
      );
    }

    var trackedSent = 0;
    for (var i = 0; i < recipients.length; i++) {
      var recipient = recipients[i];
      var personalized = recipient.token
        ? personalizeHtml_(html, recipient.token, issueId, trackingUrl)
        : html;
      MailApp.sendEmail({
        to: recipient.email,
        subject: subject,
        body: "View this email in an HTML-capable client.",
        htmlBody: personalized,
        name: fromName,
        replyTo: replyTo,
      });
      if (recipient.token) logEvent_("sent", recipient.token, issueId, "");
      trackedSent++;
      if ((i + 1) % batchSize === 0 && i < recipients.length - 1) Utilities.sleep(pauseMs);
    }

    Logger.log(
      "Sent %s/%s to %s recipient(s) individually (tracked, issue=%s).",
      type,
      mode,
      trackedSent,
      issueId
    );
    return { dryRun: false, recipients: trackedSent, batches: trackedSent, tracked: true };
  }

  // Untracked path (unchanged): one batched MailApp call per BATCH_SIZE recipients,
  // identical html for everyone.
  var emails = recipients.map(function (r) {
    return r.email;
  });
  var batches = chunk_(emails, batchSize);
  var sent = 0;
  for (var b = 0; b < batches.length; b++) {
    MailApp.sendEmail({
      to: replyTo, // sender keeps a copy per batch for visibility/confirmation
      bcc: batches[b].join(","),
      subject: subject,
      body: "View this email in an HTML-capable client.",
      htmlBody: html,
      name: fromName,
      replyTo: replyTo,
    });
    sent += batches[b].length;
    if (b < batches.length - 1) Utilities.sleep(pauseMs);
  }

  Logger.log(
    "Sent %s/%s to %s recipient(s) across %s batch(es).",
    type,
    mode,
    sent,
    batches.length
  );
  return { dryRun: false, recipients: sent, batches: batches.length };
}

// ---- Email content ----------------------------------------------------------
// Resolve the HTML body for an email type. Prefer an explicit file id
// (ISSUE_HTML_FILE_ID / UXTIP_HTML_FILE_ID) if set; otherwise auto-pick the
// newest matching .html in the configured Drive folder (ISSUE_EMAIL_FOLDER_ID /
// UXTIP_EMAIL_FOLDER_ID) so there's no per-issue file-id to update — just drop
// the new email HTML in the folder. Optional name filter: ISSUE_HTML_PATTERN /
// UXTIP_HTML_PATTERN (case-insensitive substring).
function resolveHtml_(type) {
  var isIssue = type === "issue";
  var explicitId = prop_(isIssue ? "ISSUE_HTML_FILE_ID" : "UXTIP_HTML_FILE_ID");
  if (explicitId) return DriveApp.getFileById(explicitId).getBlob().getDataAsString();

  var folderId = prop_(isIssue ? "ISSUE_EMAIL_FOLDER_ID" : "UXTIP_EMAIL_FOLDER_ID");
  if (!folderId) {
    throw new Error(
      "Set " +
        (isIssue
          ? "ISSUE_EMAIL_FOLDER_ID (or ISSUE_HTML_FILE_ID)"
          : "UXTIP_EMAIL_FOLDER_ID (or UXTIP_HTML_FILE_ID)") +
        " in Script Properties."
    );
  }
  var pattern = prop_(isIssue ? "ISSUE_HTML_PATTERN" : "UXTIP_HTML_PATTERN");
  var file = newestHtmlInFolder_(folderId, pattern);
  if (!file) {
    throw new Error(
      "No .html found in folder " + folderId + (pattern ? " matching '" + pattern + "'" : "") + "."
    );
  }
  Logger.log("Using email HTML: %s (%s)", file.getName(), file.getId());
  return file.getBlob().getDataAsString();
}

function newestHtmlInFolder_(folderId, pattern) {
  var files = DriveApp.getFolderById(folderId).getFiles();
  var pat = String(pattern || "").toLowerCase();
  var best = null;
  while (files.hasNext()) {
    var f = files.next();
    var lower = f.getName().toLowerCase();
    var isHtml = /\.html?$/.test(lower) || f.getMimeType() === "text/html";
    if (!isHtml) continue;
    if (pat && lower.indexOf(pat) === -1) continue;
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  return best;
}

// Pull the email subject out of the HTML itself so it can't drift from a separate
// Script Property. Reads <meta name="subject" content="…"> (tolerant of attribute
// order and quote style). Returns "" if the tag is absent.
function subjectFromHtml_(html) {
  var s = String(html || "");
  var m =
    /<meta[^>]*\bname\s*=\s*["']subject["'][^>]*\bcontent\s*=\s*["']([^"']*)["']/i.exec(s) ||
    /<meta[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*\bname\s*=\s*["']subject["']/i.exec(s);
  return m ? decodeEntities_(m[1]).trim() : "";
}

// Minimal HTML-entity decode so a subject authored with entities (e.g. &mdash;) is
// sent as plain text. Handles the common named + numeric entities; &amp; is last so
// an already-escaped "&amp;mdash;" resolves correctly.
function decodeEntities_(s) {
  return String(s)
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&hellip;/g, "…")
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) {
      return String.fromCharCode(parseInt(h, 16));
    })
    .replace(/&#(\d+);/g, function (_, d) {
      return String.fromCharCode(parseInt(d, 10));
    })
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

// ---- Recipient sourcing -----------------------------------------------------
function sheetRows_(tabName) {
  var id = requireProp_("RECIPIENTS_SHEET_ID");
  var sheet = SpreadsheetApp.openById(id).getSheetByName(tabName);
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  return rows.length < 2 ? [] : rows;
}

// Returns [{email, token}], not bare strings — token is "" if the Recipients
// tab has no token column yet, or that row hasn't been backfilled (see
// ensureRecipientTokens()). token is only used for the opt-in tracking path.
function activeRecipients_() {
  var rows = sheetRows_(prop_("RECIPIENTS_TAB"));
  if (!rows.length) return [];
  var headers = rows[0].map(String).map(function (h) {
    return h.trim().toLowerCase();
  });
  var emailCol = headers.indexOf(prop_("EMAIL_HEADER"));
  var activeCol = headers.indexOf(prop_("ACTIVE_HEADER"));
  var tokenCol = headers.indexOf(prop_("TOKEN_HEADER"));
  if (emailCol === -1 || activeCol === -1) {
    throw new Error('Recipients tab must include "email" and "active" columns.');
  }
  return rows
    .slice(1)
    .filter(function (row) {
      return String(row[emailCol] || "").trim() && isTruthy_(row[activeCol]);
    })
    .map(function (row) {
      return {
        email: String(row[emailCol]).trim(),
        token: tokenCol !== -1 ? String(row[tokenCol] || "").trim() : "",
      };
    });
}

function suppressedSet_() {
  var set = {};
  var rows = sheetRows_(prop_("SUPPRESSION_TAB"));
  if (!rows.length) return set;
  var emailCol = rows[0]
    .map(String)
    .map(function (h) {
      return h.trim().toLowerCase();
    })
    .indexOf(prop_("EMAIL_HEADER"));
  if (emailCol === -1) return set;
  rows.slice(1).forEach(function (row) {
    var e = String(row[emailCol] || "")
      .trim()
      .toLowerCase();
    if (e) set[e] = true;
  });
  return set;
}

function reviewers_() {
  var raw = prop_("REVIEWERS") || prop_("REPLY_TO");
  return raw
    .split(/[,;\s]+/)
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean)
    .map(function (email) {
      // Reviewers aren't in the Recipients sheet, so they have no persisted
      // token — synthesize a per-run one so test sends still exercise tracking.
      return { email: email, token: "test-" + Utilities.getUuid() };
    });
}

// ---- Helpers ----------------------------------------------------------------
function isTruthy_(value) {
  if (value === true) return true;
  var text = String(value || "")
    .trim()
    .toLowerCase();
  return ["true", "yes", "y", "1"].indexOf(text) !== -1;
}

function dedupeValid_(recipients) {
  var seen = {};
  var out = [];
  var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  recipients.forEach(function (r) {
    var email = r.email;
    var key = email.toLowerCase();
    if (re.test(email) && !seen[key]) {
      seen[key] = true;
      out.push(r);
    }
  });
  return out;
}

function chunk_(arr, size) {
  var out = [];
  for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function injectUnsubscribeFooter_(html, unsubscribeUrl) {
  if (!unsubscribeUrl) return html;
  var footer =
    '<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#8a8a8a;text-align:center;">' +
    "You're receiving this as part of the Everpure Research Roundup. " +
    '<a href="' +
    unsubscribeUrl +
    '" style="color:#8a8a8a;">Unsubscribe</a>.</p>';
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, footer + "</body>");
  return html + footer;
}

// ---- Engagement tracking (opt-in; see the header comment + README.md) -------

function trackingBaseUrl_() {
  return prop_("TRACKING_BASE_URL");
}

// Every tracked email links to its frozen archive (CLAUDE.md requires this —
// never the mutable /newsletter/default.html), so the issue id is already
// present in the body. Reusing it avoids a template placeholder just for this.
function issueIdFromHtml_(html) {
  var m = /\/issues\/(\d{4}-\d{2})\//.exec(String(html || ""));
  return m ? m[1] : "";
}

// Tracked CTAs opt in via a data-track-id attribute (see
// docs/handoff/research_roundup_email_template.html); untagged links are left
// alone and simply aren't tracked. Returns {linkId: realUrl}.
function extractTrackedLinks_(html) {
  var map = {};
  var tagRe = /<a\b[^>]*>/gi;
  var tag;
  while ((tag = tagRe.exec(String(html || "")))) {
    var idMatch = /\bdata-track-id\s*=\s*["']([^"']+)["']/i.exec(tag[0]);
    if (!idMatch) continue;
    var hrefMatch = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag[0]);
    if (!hrefMatch) continue;
    map[idMatch[1]] = decodeEntities_(hrefMatch[1]);
  }
  return map;
}

function getOrCreateSheet_(tabName, headers) {
  var ss = SpreadsheetApp.openById(requireProp_("RECIPIENTS_SHEET_ID"));
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.appendRow(headers);
  }
  return sheet;
}

// Persists this issue's known CTA destinations so doGet() can redirect a
// click by link_id lookup — never by trusting a raw destination URL from the
// (public, unauthenticated) request itself. Upserts by (issue, link_id).
function saveTrackedLinks_(issueId, linkMap) {
  var sheet = getOrCreateSheet_(prop_("TRACKED_LINKS_TAB"), ["issue", "link_id", "url"]);
  var rows = sheet.getDataRange().getValues();
  var rowForKey = {};
  for (var i = 1; i < rows.length; i++) {
    rowForKey[rows[i][0] + "|" + rows[i][1]] = i + 1;
  }
  Object.keys(linkMap).forEach(function (linkId) {
    var key = issueId + "|" + linkId;
    if (rowForKey[key]) {
      sheet.getRange(rowForKey[key], 3).setValue(linkMap[linkId]);
    } else {
      sheet.appendRow([issueId, linkId, linkMap[linkId]]);
    }
  });
}

function lookupTrackedLink_(issueId, linkId) {
  var sheet = getOrCreateSheet_(prop_("TRACKED_LINKS_TAB"), ["issue", "link_id", "url"]);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === issueId && String(rows[i][1]) === linkId) {
      return String(rows[i][2] || "");
    }
  }
  return "";
}

// Rewrites tracked <a> hrefs to the click-redirect endpoint and appends an
// open-tracking pixel before </body>. Only links already returned by
// extractTrackedLinks_() (i.e. tagged data-track-id) are rewritten.
function personalizeHtml_(html, token, issueId, trackingBaseUrl) {
  function withParams(params) {
    var sep = trackingBaseUrl.indexOf("?") === -1 ? "?" : "&";
    return (
      trackingBaseUrl +
      sep +
      Object.keys(params)
        .map(function (k) {
          return k + "=" + encodeURIComponent(params[k]);
        })
        .join("&")
    );
  }

  var out = String(html).replace(/<a\b[^>]*>/gi, function (tag) {
    var idMatch = /\bdata-track-id\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!idMatch) return tag;
    var trackedHref = withParams({ e: "click", r: token, i: issueId, l: idMatch[1] });
    return tag.replace(/\bhref\s*=\s*["'][^"']*["']/i, 'href="' + trackedHref + '"');
  });

  var pixelUrl = withParams({ e: "open", r: token, i: issueId });
  var pixel =
    '<img src="' + pixelUrl + '" width="1" height="1" alt="" style="display:none;border:0;" />';
  return /<\/body>/i.test(out) ? out.replace(/<\/body>/i, pixel + "</body>") : out + pixel;
}

// A cell value beginning with =, +, -, or @ is parsed as a live formula by
// Sheets (identical to typing it into the UI) — and doGet() below writes
// public, unauthenticated request params into this sheet, so every value
// reaching appendRow here must be defused first regardless of the shape
// validation in doGet(), as a second independent layer.
function sheetSafeValue_(value) {
  var s = String(value == null ? "" : value);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function logEvent_(eventType, token, issueId, linkId) {
  var sheet = getOrCreateSheet_(prop_("EVENTS_TAB"), [
    "timestamp",
    "event",
    "token",
    "issue",
    "link",
  ]);
  sheet.appendRow([
    new Date(),
    eventType,
    sheetSafeValue_(token),
    sheetSafeValue_(issueId),
    sheetSafeValue_(linkId || ""),
  ]);
}

// Apps Script's ContentService/HtmlOutput can only return HTML/text content —
// there is no image mimetype available, so a real GIF byte stream isn't
// achievable here. That's fine for tracking purposes: the GET request itself
// is what gets logged, before this response is ever built; the reply is just
// what the <img> tag receives afterward (harmlessly empty).
function onePixelGif_() {
  return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.TEXT);
}

// Apps Script's doGet can't send a real HTTP redirect, so this is the standard
// workaround: an HTML shell with a <meta refresh> + JS fallback. `url` must
// already be a server-known destination resolved via lookupTrackedLink_() —
// never build this from unvalidated request input (open-redirect guard).
function redirectTo_(url) {
  var str = String(url);
  var attr = str.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  var js = JSON.stringify(str).replace(/</g, "\\u003c");
  return HtmlService.createHtmlOutput(
    '<html><head><meta http-equiv="refresh" content="0; url=' +
      attr +
      '"></head><body><script>location.replace(' +
      js +
      ");</script></body></html>"
  );
}

// doGet()'s r/i/l params come straight from an unauthenticated public request
// (access: Anyone) with nothing to check them against — there's no live
// lookup against real recipients/issues, since that would mean a Sheets read
// on every open/click hit for a small internal newsletter. Requiring each
// param to match the shape it's always generated in (see
// ensureRecipientTokens/Utilities.getUuid, reviewers_, issueIdFromHtml_,
// data-track-id in the email template) is cheap insurance: it can't stop
// someone from replaying a plausible-looking fake token, but it does reject
// garbage outright — including, incidentally, values like "__proto__" that
// would otherwise corrupt buildEngagementSummary()'s plain-object map.
function isValidToken_(token) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(token);
}

function isValidIssueId_(issueId) {
  return /^\d{4}-\d{2}$/.test(issueId);
}

function isValidLinkId_(linkId) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(linkId);
}

// redirectTo_()'s open-redirect guard only constrains WHERE a destination URL
// comes from (always the TrackedLinks sheet, never a raw request param) — not
// WHAT it contains. Without this, a bad edit to a CTA href, or a direct edit
// of the (ordinarily human-editable) TrackedLinks sheet, could smuggle a
// javascript:/data: URI into the HTML doGet() returns, which
// location.replace() would execute. Fail closed to the no-op pixel instead.
function isSafeRedirectUrl_(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

// Web App entry point (deploy: Deploy → New deployment → Web app, execute as
// "Me", access "Anyone"). See README.md "Engagement tracking" for the
// deployed /exec URL → TRACKING_BASE_URL Script Property step.
function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var token = String(params.r || "").trim();
    var issueId = String(params.i || "").trim();
    if (!isValidToken_(token) || !isValidIssueId_(issueId)) return onePixelGif_();

    if (params.e === "click") {
      var linkId = String(params.l || "").trim();
      if (!isValidLinkId_(linkId)) return onePixelGif_();
      var url = lookupTrackedLink_(issueId, linkId);
      logEvent_("click", token, issueId, linkId);
      if (url && isSafeRedirectUrl_(url)) return redirectTo_(url);
      return onePixelGif_();
    }

    logEvent_("open", token, issueId, "");
    return onePixelGif_();
  } catch (err) {
    return onePixelGif_();
  }
}

// One-time (then occasional, as people are added) backfill: writes a stable
// opaque token into any Recipients row that doesn't have one yet. Requires a
// "token" header already present in the Recipients tab — run this manually
// from the Apps Script editor before the first tracked send.
function ensureRecipientTokens() {
  var sheet = SpreadsheetApp.openById(requireProp_("RECIPIENTS_SHEET_ID")).getSheetByName(
    prop_("RECIPIENTS_TAB")
  );
  if (!sheet) throw new Error("Recipients tab not found.");
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    Logger.log("No recipient rows.");
    return { updated: 0 };
  }
  var headers = values[0].map(String).map(function (h) {
    return h.trim().toLowerCase();
  });
  var emailCol = headers.indexOf(prop_("EMAIL_HEADER"));
  var tokenCol = headers.indexOf(prop_("TOKEN_HEADER"));
  if (emailCol === -1) throw new Error('Recipients tab must include an "email" column.');
  if (tokenCol === -1) {
    throw new Error(
      'Recipients tab has no "token" column yet — add one (header exactly "token") before running ensureRecipientTokens().'
    );
  }
  var updated = 0;
  for (var i = 1; i < values.length; i++) {
    var email = String(values[i][emailCol] || "").trim();
    var token = String(values[i][tokenCol] || "").trim();
    if (email && !token) {
      sheet.getRange(i + 1, tokenCol + 1).setValue(Utilities.getUuid());
      updated++;
    }
  }
  Logger.log("Backfilled %s token(s).", updated);
  return { updated: updated };
}

// Rebuilds the EngagementSummary tab from EmailEvents. Recipient counts come
// from "sent" events logged at send time, NOT the current activeRecipients_()
// list — the list's size drifts over time, but a past issue's send count
// shouldn't. This sheet is a derived view (safe to fully rebuild each run),
// stays private (normal Sheets sharing), and is the only place per-recipient
// "who opened/clicked" detail lives — never surfaced on the public site.
function buildEngagementSummary() {
  var eventsSheet = getOrCreateSheet_(prop_("EVENTS_TAB"), [
    "timestamp",
    "event",
    "token",
    "issue",
    "link",
  ]);
  var rows = eventsSheet.getDataRange().getValues();
  var byIssue = {};
  function forIssue(issue) {
    if (!byIssue[issue]) byIssue[issue] = { sent: {}, opens: {}, clicks: {}, linkCounts: {} };
    return byIssue[issue];
  }

  for (var i = 1; i < rows.length; i++) {
    var eventType = String(rows[i][1] || "");
    var token = String(rows[i][2] || "");
    var issue = String(rows[i][3] || "");
    var link = String(rows[i][4] || "");
    if (!issue || !token) continue;
    var bucket = forIssue(issue);
    if (eventType === "sent") bucket.sent[token] = true;
    else if (eventType === "open") bucket.opens[token] = true;
    else if (eventType === "click") {
      bucket.clicks[token] = true;
      if (link) bucket.linkCounts[link] = (bucket.linkCounts[link] || 0) + 1;
    }
  }

  var headers = [
    "issue",
    "recipients",
    "unique_opens",
    "unique_clicks",
    "open_rate",
    "click_rate",
    "top_link",
  ];
  var summarySheet = getOrCreateSheet_(prop_("SUMMARY_TAB"), headers);
  summarySheet.clearContents();
  summarySheet.appendRow(headers);

  Object.keys(byIssue)
    .sort()
    .forEach(function (issue) {
      var b = byIssue[issue];
      var recipients = Object.keys(b.sent).length;
      var opens = Object.keys(b.opens).length;
      var clicks = Object.keys(b.clicks).length;
      var topLink = "";
      var topCount = 0;
      Object.keys(b.linkCounts).forEach(function (linkId) {
        if (b.linkCounts[linkId] > topCount) {
          topCount = b.linkCounts[linkId];
          topLink = linkId;
        }
      });
      summarySheet.appendRow([
        issue,
        recipients,
        opens,
        clicks,
        recipients ? opens / recipients : 0,
        recipients ? clicks / recipients : 0,
        topLink,
      ]);
    });

  Logger.log("Rebuilt EngagementSummary for %s issue(s).", Object.keys(byIssue).length);
  return byIssue;
}
