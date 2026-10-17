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
 * Engagement tracking (opens/clicks) is OPT-IN, in one of two modes (see
 * README.md "Engagement tracking"):
 *   - GA4 (GA_MEASUREMENT_ID set — preferred): each tracked link goes straight
 *     to the site with the recipient's opaque token (rid) and the link id
 *     (utm_content) added, so GA4 records the visit; opens are a 1×1 hit to
 *     GA4's collection endpoint. Nothing sits in the click path, so there's no
 *     sign-in and external recipients get through.
 *   - Web App (only TRACKING_BASE_URL set — legacy): links and the open pixel
 *     route through doGet(). Only works if the Web App's access is "Anyone";
 *     the Pure Storage Workspace only allows "Anyone within Pure Storage",
 *     which puts a Google sign-in in front of every click.
 * Until either is set, send_() sends one batched MailApp call per BATCH_SIZE
 * recipients, identical html for everyone. Once tracking is on, it sends ONE
 * call per recipient instead — real per-recipient identity is the whole
 * point, which a shared batch body can't carry. See ensureRecipientTokens() /
 * personalizeGaHtml_() / doGet() / buildEngagementSummary() below.
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
  RECIPIENT_ENGAGEMENT_TAB: "RecipientEngagement", // tracking: private per-person view
  NAME_HEADER: "name", // optional Recipients column shown in RecipientEngagement
  GA_START_DATE: "2026-10-01", // GA4 mode's first send; earlier data has no rid
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
//             UNSUBSCRIBE_URL,
//             GA_MEASUREMENT_ID (the site's GA4 id, e.g. G-… — opt-in tracking via GA4),
//             GA_PROPERTY_ID (the numeric GA4 property id — lets the engagement
//               reports read GA4 opens/clicks; see buildRecipientEngagement()),
//             TRACKING_BASE_URL (deployed Web App /exec URL — legacy opt-in tracking)

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
  var trackingMode = trackingMode_();
  var trackingUrl = trackingBaseUrl_();
  var gaId = prop_("GA_MEASUREMENT_ID");

  if (dryRun) {
    var previewBatches = trackingMode ? recipients.length : chunk_(recipients, batchSize).length;
    Logger.log(
      "[DRY RUN] %s/%s — %s recipient(s), %s, %s. Quota remaining: %s.",
      type,
      mode,
      recipients.length,
      trackingMode
        ? "sent individually (tracking enabled)"
        : previewBatches + " batch(es) of " + batchSize,
      trackingMode === "ga"
        ? "tracked via GA4 " + gaId
        : trackingMode === "webapp"
          ? "tracked via the Web App"
          : "untracked",
      remaining
    );
    if (trackingMode) {
      var trackedIds = Object.keys(extractTrackedLinks_(html));
      Logger.log(
        "Issue: %s. Tracked links: %s (%s).",
        issueIdFromHtml_(html) || type,
        trackedIds.length,
        trackedIds.join(", ")
      );
    }
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

  // Tracking (opens/clicks) is opt-in: only activates once GA_MEASUREMENT_ID or
  // TRACKING_BASE_URL is set. Real per-recipient identity needs a personalized body,
  // which a shared BCC batch can't carry, so this path sends one MailApp call per
  // recipient. "sent" events still land in EmailEvents in both modes, so
  // buildEngagementSummary() keeps each issue's recipient count.
  if (trackingMode) {
    var issueId = issueIdFromHtml_(html) || type;
    if (trackingMode === "webapp") {
      var linkMap = extractTrackedLinks_(html);
      if (Object.keys(linkMap).length) saveTrackedLinks_(issueId, linkMap);
    }
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
      var personalized = !recipient.token
        ? html
        : trackingMode === "ga"
          ? personalizeGaHtml_(html, recipient.token, issueId, gaId, mode === "test", Date.now())
          : personalizeHtml_(html, recipient.token, issueId, trackingUrl);
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
      "Sent %s/%s to %s recipient(s) individually (tracked via %s, issue=%s).",
      type,
      mode,
      trackedSent,
      trackingMode === "ga" ? "GA4" : "the Web App",
      issueId
    );
    return {
      dryRun: false,
      recipients: trackedSent,
      batches: trackedSent,
      tracked: true,
      trackingMode: trackingMode,
    };
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

// "ga" when GA_MEASUREMENT_ID is set (it wins over the Web App), "webapp" when only
// TRACKING_BASE_URL is set, "" when tracking is off.
function trackingMode_() {
  if (prop_("GA_MEASUREMENT_ID")) return "ga";
  if (trackingBaseUrl_()) return "webapp";
  return "";
}

// GA4 mode. Each data-track-id link keeps its real destination and gains two
// params: utm_content (the link id — which CTA) and rid (the recipient's opaque
// token — never an email, which GA4's terms forbid). The site's gtag config records
// both in page_location on page load, so no redirect, sign-in, or Sheets write sits
// in the click path. Opens are a 1×1 hit to GA4's collection endpoint, the one
// gtag.js itself uses: GA4 has no documented GET endpoint for email opens, so treat
// these as directional (Apple Mail pre-loads images; Gmail caches after the first
// open). `debug` (test sends) adds GA4's _dbg flag. Verify opens in GA4 Realtime overview
// (Event count by Event name): DebugView doesn't list these GET hits, but Realtime does —
// confirmed with a Gmail test send on 2026-10-16, so Gmail's image proxy gets through.
function personalizeGaHtml_(html, token, issueId, measurementId, debug, nowMs) {
  var out = String(html).replace(/<a\b[^>]*>/gi, function (tag) {
    var idMatch = /\bdata-track-id\s*=\s*["']([^"']+)["']/i.exec(tag);
    var hrefMatch = /\bhref\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (!idMatch || !hrefMatch) return tag;
    var url = withQueryParams_(decodeEntities_(hrefMatch[1]), {
      utm_content: idMatch[1],
      rid: token,
    });
    return tag.replace(hrefMatch[0], function () {
      return 'href="' + escapeAttr_(url) + '"';
    });
  });

  var pixelUrl = gaOpenPixelUrl_(
    measurementId,
    token,
    issueId,
    siteRootFromHtml_(html),
    debug,
    nowMs
  );
  var pixel =
    '<img src="' +
    escapeAttr_(pixelUrl) +
    '" width="1" height="1" alt="" style="display:none;border:0;" />';
  return /<\/body>/i.test(out) ? out.replace(/<\/body>/i, pixel + "</body>") : out + pixel;
}

// The open hit: event email_open, client id = the recipient's token. page_location is
// a synthetic /email/<issue>/open path on the site (carrying rid, like the click
// side), so opens are filterable in GA4 without a custom dimension and never count
// toward the issue page's own users. No session-start flags, so an open alone isn't
// an engaged session.
function gaOpenPixelUrl_(measurementId, token, issueId, siteRoot, debug, nowMs) {
  var params = {
    v: "2",
    tid: measurementId,
    cid: token,
    sid: String(Math.floor((nowMs || 0) / 1000)),
    sct: "1",
    seg: "0",
    en: "email_open",
    dt: "Email open · " + issueId,
    "ep.issue_id": issueId,
  };
  if (siteRoot)
    params.dl = withQueryParams_(siteRoot + "/email/" + issueId + "/open", { rid: token });
  if (debug) params._dbg = "1";
  return withQueryParams_("https://www.google-analytics.com/g/collect", params);
}

// The site root the email links into (everything before /issues/YYYY-MM/), or "".
function siteRootFromHtml_(html) {
  var m = /(https?:\/\/[^"'\s<>]+?)\/issues\/\d{4}-\d{2}\//.exec(String(html || ""));
  return m ? m[1] : "";
}

// Sets query params on a URL (replacing any already there), keeping the #fragment last.
function withQueryParams_(url, params) {
  var s = String(url);
  var hashAt = s.indexOf("#");
  var hash = hashAt === -1 ? "" : s.slice(hashAt);
  var rest = hashAt === -1 ? s : s.slice(0, hashAt);
  var qAt = rest.indexOf("?");
  var base = qAt === -1 ? rest : rest.slice(0, qAt);
  var pairs = (qAt === -1 ? "" : rest.slice(qAt + 1)).split("&").filter(function (p) {
    return p && !Object.prototype.hasOwnProperty.call(params, p.split("=")[0]);
  });
  Object.keys(params).forEach(function (k) {
    pairs.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
  });
  return base + "?" + pairs.join("&") + hash;
}

function escapeAttr_(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
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
    rowForKey[normalizeIssueCell_(rows[i][0]) + "|" + rows[i][1]] = i + 1;
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
    if (normalizeIssueCell_(rows[i][0]) === issueId && String(rows[i][1]) === linkId) {
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

// Sheets can silently auto-detect a plain "YYYY-MM" issue id (e.g. "2026-09")
// as a date and store the cell as a Date instead of the string that was
// written — which breaks every exact-string comparison this file relies on
// (TrackedLinks/EmailEvents lookups keyed by issue). Normalize a cell back to
// "YYYY-MM" before comparing so a coerced cell still matches a plain-string
// issue id from a request param or from ensureRecipientTokens-style code.
function normalizeIssueCell_(value) {
  if (value instanceof Date) {
    return value.getFullYear() + "-" + String(value.getMonth() + 1).padStart(2, "0");
  }
  return String(value == null ? "" : value);
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

// ---- Engagement reports (private; run a day or two after a send) -------------
//
// Opens and clicks come from two places, merged per (recipient token, issue):
//   - EmailEvents: a "sent" row per recipient (both tracking modes), plus the legacy
//     Web App mode's open/click rows;
//   - GA4, when GA_PROPERTY_ID is set: GA4 mode's email_open hits and the page views
//     its rid-tagged links produce (read via the Google Analytics Data API advanced
//     service; GA4's standard data lags 24–48 hours).
// Activity only counts for a (token, issue) with a "sent" row — only send_() writes
// those, so a crafted GA4 hit or a made-up rid can't add a recipient. A click counts as
// an open too (opening the email is the only way to click it, and Outlook often blocks
// the pixel). Test-send tokens ("test-…") are left out. Both
// reports stay in this private spreadsheet: only EngagementSummary's aggregate
// numbers are ever transcribed to the public site (netlify/content/email_engagement.json).

// Rebuilds EngagementSummary: one row per issue — recipients, unique opens/clicks,
// rates, and the most-clicked link. Recipient counts come from "sent" rows logged at
// send time, not the current Recipients list, so past issues' rates don't drift.
function buildEngagementSummary() {
  var data = collectEngagement_();
  return writeEngagementSummary_(data);
}

// Rebuilds RecipientEngagement — one row per recipient: issues received, opened, and
// clicked, their open/click rates, last activity, links clicked, and a status column
// per issue — and refreshes EngagementSummary from the same data. Names come from an
// optional "name" column in Recipients (NAME_HEADER); otherwise the email identifies
// the row. Per-person "opened" is a hint, not proof (Apple Mail pre-loads images,
// Outlook blocks them, a forward credits the original recipient); clicks are solid.
function buildRecipientEngagement() {
  var data = collectEngagement_();
  var dir = recipientDirectory_();
  var issues = issuesIn_(data).reverse(); // newest first
  var header = (dir.hasNames ? ["name"] : []).concat([
    "email",
    "active",
    "issues_received",
    "issues_opened",
    "issues_clicked",
    "open_rate",
    "click_rate",
    "last_seen",
    "links_clicked",
  ]);
  var base = header.length;
  header = header.concat(issues);

  var rows = [];
  var unmatched = 0;
  Object.keys(data.byToken).forEach(function (token) {
    var person = dir.byToken[token];
    if (!person) {
      unmatched++;
      return;
    }
    var perIssue = data.byToken[token];
    var received = 0;
    var opened = 0;
    var clicked = 0;
    var links = Object.create(null);
    Object.keys(perIssue).forEach(function (issue) {
      var e = perIssue[issue];
      received++;
      if (e.opened || e.clicked) opened++;
      if (e.clicked) clicked++;
      Object.keys(e.links).forEach(function (l) {
        links[l] = (links[l] || 0) + e.links[l];
      });
    });
    var row = (dir.hasNames ? [person.name] : []).concat([
      person.email,
      person.active ? "yes" : "no",
      received,
      opened,
      clicked,
      received ? opened / received : 0,
      received ? clicked / received : 0,
      data.lastSeen[token] || "",
      Object.keys(links)
        .sort(function (a, b) {
          return links[b] - links[a] || (a < b ? -1 : 1);
        })
        .map(function (l) {
          return links[l] > 1 ? l + " ×" + links[l] : l;
        })
        .join(", "),
    ]);
    issues.forEach(function (issue) {
      var e = perIssue[issue];
      row.push(!e ? "" : e.clicked ? "clicked" : e.opened ? "opened" : "not opened");
    });
    rows.push(row);
  });

  var emailCol = dir.hasNames ? 1 : 0;
  var clickRateCol = base - 3;
  var openRateCol = base - 4;
  rows.sort(function (a, b) {
    return (
      b[clickRateCol] - a[clickRateCol] ||
      b[openRateCol] - a[openRateCol] ||
      (a[emailCol] < b[emailCol] ? -1 : 1)
    );
  });

  var textCols = [base - 2];
  for (var c = base; c < header.length; c++) textCols.push(c);
  writeTable_(prop_("RECIPIENT_ENGAGEMENT_TAB"), header, rows, {
    textCols: textCols,
    percentCols: [openRateCol, clickRateCol],
  });
  writeEngagementSummary_(data);

  if (unmatched) {
    Logger.log(
      "%s token(s) have activity but no Recipients row (removed rows?) — skipped.",
      unmatched
    );
  }
  Logger.log(
    "Rebuilt RecipientEngagement: %s recipient(s) across %s issue(s)%s.",
    rows.length,
    issues.length,
    data.gaEnabled
      ? ", with GA4 data (" + data.gaRows + " row(s))"
      : " (EmailEvents only — set GA_PROPERTY_ID to add GA4)"
  );
  return { recipients: rows.length, issues: issues.length, unmatched: unmatched };
}

function writeEngagementSummary_(data) {
  var byIssue = Object.create(null);
  Object.keys(data.byToken).forEach(function (token) {
    Object.keys(data.byToken[token]).forEach(function (issue) {
      var e = data.byToken[token][issue];
      var b =
        byIssue[issue] ||
        (byIssue[issue] = { recipients: 0, opens: 0, clicks: 0, links: Object.create(null) });
      b.recipients++;
      if (e.opened || e.clicked) b.opens++;
      if (e.clicked) b.clicks++;
      Object.keys(e.links).forEach(function (l) {
        b.links[l] = (b.links[l] || 0) + e.links[l];
      });
    });
  });

  var header = [
    "issue",
    "recipients",
    "unique_opens",
    "unique_clicks",
    "open_rate",
    "click_rate",
    "top_link",
  ];
  var rows = Object.keys(byIssue)
    .sort()
    .map(function (issue) {
      var b = byIssue[issue];
      var topLink = "";
      Object.keys(b.links).forEach(function (l) {
        if (!topLink || b.links[l] > b.links[topLink]) topLink = l;
      });
      return [
        issue,
        b.recipients,
        b.opens,
        b.clicks,
        b.recipients ? b.opens / b.recipients : 0,
        b.recipients ? b.clicks / b.recipients : 0,
        topLink,
      ];
    });
  writeTable_(prop_("SUMMARY_TAB"), header, rows, { textCols: [0], percentCols: [4, 5] });
  Logger.log("Rebuilt EngagementSummary for %s issue(s).", rows.length);
  return byIssue;
}

// Merges EmailEvents and (when GA_PROPERTY_ID is set) GA4 into
// { byToken: {token: {issue: {opened, clicked, links: {linkId: n}}}}, lastSeen: {token: "YYYY-MM-DD"} },
// keeping only (token, issue) pairs with a "sent" row and dropping test-send tokens.
// Keys come from request-derived data, so every map is prototype-free and every
// token/issue/link id is shape-validated before use.
function collectEngagement_() {
  var byToken = Object.create(null);
  var lastSeen = Object.create(null);
  function entry(token, issue) {
    var perIssue = byToken[token] || (byToken[token] = Object.create(null));
    return (
      perIssue[issue] ||
      (perIssue[issue] = {
        sent: false,
        opened: false,
        clicked: false,
        links: Object.create(null),
        seen: "",
      })
    );
  }
  function seen(e, day) {
    if (day > e.seen) e.seen = day;
  }

  var events = getOrCreateSheet_(prop_("EVENTS_TAB"), [
    "timestamp",
    "event",
    "token",
    "issue",
    "link",
  ])
    .getDataRange()
    .getValues();
  for (var i = 1; i < events.length; i++) {
    var type = String(events[i][1] || "");
    var token = String(events[i][2] || "");
    var issue = normalizeIssueCell_(events[i][3]);
    var link = String(events[i][4] || "");
    if (!isValidToken_(token) || !isValidIssueId_(issue)) continue;
    var e = entry(token, issue);
    if (type === "sent") e.sent = true;
    if (type === "open") e.opened = true;
    if (type === "click") {
      e.clicked = true;
      if (isValidLinkId_(link)) e.links[link] = (e.links[link] || 0) + 1;
    }
    if ((type === "open" || type === "click") && events[i][0] instanceof Date)
      seen(e, ymd_(events[i][0]));
  }

  var propertyId = prop_("GA_PROPERTY_ID");
  var gaRows = propertyId ? fetchGaEmailEvents_(propertyId) : [];
  gaRows.forEach(function (row) {
    var hit = parseEmailHit_(row.event, row.pageLocation);
    if (!hit) return;
    var e = entry(hit.token, hit.issue);
    if (hit.kind === "open") e.opened = true;
    else {
      e.clicked = true;
      if (hit.link) e.links[hit.link] = (e.links[hit.link] || 0) + row.count;
    }
    if (/^\d{8}$/.test(row.date)) {
      seen(e, row.date.slice(0, 4) + "-" + row.date.slice(4, 6) + "-" + row.date.slice(6));
    }
  });

  Object.keys(byToken).forEach(function (token) {
    var perIssue = byToken[token];
    Object.keys(perIssue).forEach(function (issue) {
      if (!perIssue[issue].sent || isTestToken_(token)) delete perIssue[issue];
    });
    var kept = Object.keys(perIssue);
    if (!kept.length) {
      delete byToken[token];
      return;
    }
    kept.forEach(function (issue) {
      var day = perIssue[issue].seen;
      if (day && (!lastSeen[token] || day > lastSeen[token])) lastSeen[token] = day;
    });
  });

  return { byToken: byToken, lastSeen: lastSeen, gaEnabled: !!propertyId, gaRows: gaRows.length };
}

// GA4 rows for every email_open hit and email-link page view (anything whose
// page_location carries rid=) since GA_START_DATE, via the Google Analytics Data API
// advanced service (appsscript.json enables it, with the analytics.readonly scope).
function fetchGaEmailEvents_(propertyId) {
  var property = /^properties\//.test(propertyId) ? propertyId : "properties/" + propertyId;
  var rows = [];
  var limit = 10000;
  for (var offset = 0; ; offset += limit) {
    var report = AnalyticsData.Properties.runReport(
      {
        dateRanges: [{ startDate: prop_("GA_START_DATE"), endDate: "today" }],
        dimensions: [{ name: "eventName" }, { name: "pageLocation" }, { name: "date" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              {
                filter: {
                  fieldName: "eventName",
                  inListFilter: { values: ["email_open", "page_view"] },
                },
              },
              {
                filter: {
                  fieldName: "pageLocation",
                  stringFilter: { matchType: "CONTAINS", value: "rid=" },
                },
              },
            ],
          },
        },
        limit: limit,
        offset: offset,
      },
      property
    );
    if (report.metadata && report.metadata.subjectToThresholding) {
      Logger.log(
        "GA4 applied data thresholds — some rows may be withheld. Admin → Reporting identity → " +
          "Device-based removes them."
      );
    }
    (report.rows || []).forEach(function (r) {
      rows.push({
        event: r.dimensionValues[0].value,
        pageLocation: r.dimensionValues[1].value,
        date: r.dimensionValues[2].value,
        count: Number(r.metricValues[0].value) || 0,
      });
    });
    if (!report.rows || offset + limit >= (Number(report.rowCount) || 0)) break;
  }
  return rows;
}

// One GA4 row → {kind: "open"|"click", token, issue, link} or null. Opens are
// email_open hits on <site>/email/YYYY-MM/open; clicks are page views of
// /issues/YYYY-MM/… whose URL carries rid (only email links add it). Anyone can send
// GA4 a hit or visit a crafted URL, so everything is shape-validated here.
function parseEmailHit_(eventName, pageLocation) {
  var url = String(pageLocation || "");
  var q = url.indexOf("?");
  if (q === -1) return null;
  var path = url.slice(0, q);
  var params = Object.create(null);
  url
    .slice(q + 1)
    .split("#")[0]
    .split("&")
    .forEach(function (pair) {
      var eq = pair.indexOf("=");
      try {
        var k = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
        params[k] = decodeURIComponent((eq === -1 ? "" : pair.slice(eq + 1)).replace(/\+/g, " "));
      } catch (err) {
        // malformed escape — ignore the pair
      }
    });
  var token = params.rid || "";
  if (!isValidToken_(token)) return null;
  var m;
  if (eventName === "email_open" && (m = /\/email\/(\d{4}-\d{2})\/open$/.exec(path))) {
    return { kind: "open", token: token, issue: m[1], link: "" };
  }
  if (eventName === "page_view" && (m = /\/issues\/(\d{4}-\d{2})\//.exec(path))) {
    var link = params.utm_content || "";
    return { kind: "click", token: token, issue: m[1], link: isValidLinkId_(link) ? link : "" };
  }
  return null;
}

// Every Recipients row with a token (active or not, so history survives someone
// leaving the list): {byToken: {token: {email, name, active}}, hasNames}.
function recipientDirectory_() {
  var rows = sheetRows_(prop_("RECIPIENTS_TAB"));
  var byToken = Object.create(null);
  if (!rows.length) return { byToken: byToken, hasNames: false };
  var headers = rows[0].map(String).map(function (h) {
    return h.trim().toLowerCase();
  });
  var emailCol = headers.indexOf(prop_("EMAIL_HEADER"));
  var activeCol = headers.indexOf(prop_("ACTIVE_HEADER"));
  var tokenCol = headers.indexOf(prop_("TOKEN_HEADER"));
  var nameCol = headers.indexOf(prop_("NAME_HEADER"));
  if (emailCol === -1 || tokenCol === -1) {
    throw new Error(
      'Recipients tab must include "email" and "token" columns (see ensureRecipientTokens).'
    );
  }
  rows.slice(1).forEach(function (row) {
    var token = String(row[tokenCol] || "").trim();
    if (!token) return;
    byToken[token] = {
      email: String(row[emailCol] || "").trim(),
      name: nameCol !== -1 ? String(row[nameCol] || "").trim() : "",
      active: activeCol !== -1 && isTruthy_(row[activeCol]),
    };
  });
  return { byToken: byToken, hasNames: nameCol !== -1 };
}

function issuesIn_(data) {
  var set = Object.create(null);
  Object.keys(data.byToken).forEach(function (token) {
    Object.keys(data.byToken[token]).forEach(function (issue) {
      set[issue] = true;
    });
  });
  return Object.keys(set).sort();
}

// Reviewers' test sends use synthesized "test-…" tokens (reviewers_()).
function isTestToken_(token) {
  return /^test-/.test(token);
}

function ymd_(date) {
  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}

// Clears a tab and writes header + rows in one setValues. Strings are defused
// (sheetSafeValue_) since some come from GA4/request data, and textCols (issue ids
// like "2026-10", which Sheets would otherwise turn into dates) are pinned to plain
// text before the write; percentCols get a 0% format.
function writeTable_(tabName, header, rows, opts) {
  var sheet = getOrCreateSheet_(tabName, header);
  sheet.clearContents();
  var values = [header].concat(rows).map(function (row) {
    return row.map(function (v) {
      return typeof v === "string" ? sheetSafeValue_(v) : v;
    });
  });
  sheet.getRange(1, 1, 1, header.length).setNumberFormat("@");
  (opts.textCols || []).forEach(function (c) {
    sheet.getRange(1, c + 1, values.length, 1).setNumberFormat("@");
  });
  if (rows.length) {
    (opts.percentCols || []).forEach(function (c) {
      sheet.getRange(2, c + 1, rows.length, 1).setNumberFormat("0%");
    });
  }
  sheet.getRange(1, 1, values.length, header.length).setValues(values);
  sheet.setFrozenRows(1);
}
