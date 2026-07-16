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
 */

// ---- Config (defaults; override via Script Properties) ----------------------
var DEFAULTS = {
  RECIPIENTS_TAB: "Recipients",
  EMAIL_HEADER: "email",
  ACTIVE_HEADER: "active",
  SUPPRESSION_TAB: "Unsubscribed", // optional tab with an "email" column to skip
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
//             UNSUBSCRIBE_URL

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
    recipients = recipients.filter(function (e) {
      return !suppressed[e.toLowerCase()];
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
  var batches = chunk_(recipients, batchSize);

  if (dryRun) {
    Logger.log(
      "[DRY RUN] %s/%s — %s recipient(s) in %s batch(es) of %s. Quota remaining: %s.",
      type,
      mode,
      recipients.length,
      batches.length,
      batchSize,
      remaining
    );
    Logger.log("Sample: %s", recipients.slice(0, 5).join(", "));
    return { dryRun: true, recipients: recipients.length, batches: batches.length };
  }

  var sent = 0;
  for (var i = 0; i < batches.length; i++) {
    MailApp.sendEmail({
      to: replyTo, // sender keeps a copy per batch for visibility/confirmation
      bcc: batches[i].join(","),
      subject: subject,
      body: "View this email in an HTML-capable client.",
      htmlBody: html,
      name: fromName,
      replyTo: replyTo,
    });
    sent += batches[i].length;
    if (i < batches.length - 1) Utilities.sleep(pauseMs);
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

function activeRecipients_() {
  var rows = sheetRows_(prop_("RECIPIENTS_TAB"));
  if (!rows.length) return [];
  var headers = rows[0].map(String).map(function (h) {
    return h.trim().toLowerCase();
  });
  var emailCol = headers.indexOf(prop_("EMAIL_HEADER"));
  var activeCol = headers.indexOf(prop_("ACTIVE_HEADER"));
  if (emailCol === -1 || activeCol === -1) {
    throw new Error('Recipients tab must include "email" and "active" columns.');
  }
  return rows
    .slice(1)
    .filter(function (row) {
      return String(row[emailCol] || "").trim() && isTruthy_(row[activeCol]);
    })
    .map(function (row) {
      return String(row[emailCol]).trim();
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
    .filter(Boolean);
}

// ---- Helpers ----------------------------------------------------------------
function isTruthy_(value) {
  if (value === true) return true;
  var text = String(value || "")
    .trim()
    .toLowerCase();
  return ["true", "yes", "y", "1"].indexOf(text) !== -1;
}

function dedupeValid_(emails) {
  var seen = {};
  var out = [];
  var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  emails.forEach(function (e) {
    var key = e.toLowerCase();
    if (re.test(e) && !seen[key]) {
      seen[key] = true;
      out.push(e);
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
