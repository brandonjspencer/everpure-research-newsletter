#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { docHead, sidebar } = require("./dashboard_theme");
const { monthLabel } = require("./build_trends");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function exists(p) {
  return fs.existsSync(p);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function removeDirIfExists(dir) {
  if (exists(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function listIssueMonths(issuesDir) {
  if (!exists(issuesDir)) return [];
  return fs
    .readdirSync(issuesDir)
    .filter(
      (entry) =>
        /^\d{4}-\d{2}$/.test(entry) && exists(path.join(issuesDir, entry, "issue_manifest.json"))
    )
    .sort((a, b) => b.localeCompare(a));
}

function buildIssuesCatalog(publishDir) {
  const issuesDir = path.join(publishDir, "issues");
  const months = listIssueMonths(issuesDir);
  // Chronological issue numbers (oldest = 01) as a fallback when an issue's
  // default.json lacks an explicit number.
  const numberByMonth = {};
  [...months].sort().forEach((m, i) => {
    numberByMonth[m] = String(i + 1).padStart(2, "0");
  });
  const issues = months.map((month) => {
    const manifestPath = path.join(issuesDir, month, "issue_manifest.json");
    const manifest = readJson(manifestPath, {}) || {};
    const issueDoc = readJson(path.join(issuesDir, month, "default.json"), {}) || {};
    const issueMeta = issueDoc.issue && typeof issueDoc.issue === "object" ? issueDoc.issue : {};
    const issueLabel = issueMeta.label || `Issue ${issueMeta.number || numberByMonth[month]}`;
    return {
      issue_id: manifest.issue_id || `everpure-${month}`,
      issue_month: month,
      month_label: monthLabel(month),
      issue_label: issueLabel,
      generated_at: manifest.generated_at || null,
      audience: manifest.audience || manifest?.default_issue?.audience || null,
      tone: manifest.tone || manifest?.default_issue?.tone || null,
      links: {
        default_html: `issues/${month}/default.html`,
        default_md: `issues/${month}/default.md`,
        default_json: `issues/${month}/default.json`,
        marketing_html: `issues/${month}/marketing-activity-30d.html`,
        marketing_md: `issues/${month}/marketing-activity-30d.md`,
        marketing_json: `issues/${month}/marketing-activity-30d.json`,
        manifest: `issues/${month}/issue_manifest.json`,
      },
    };
  });

  ensureDir(path.join(publishDir, "data"));
  const payload = {
    generated_at: new Date().toISOString(),
    issue_count: issues.length,
    issues,
  };
  fs.writeFileSync(
    path.join(publishDir, "data", "issues.json"),
    JSON.stringify(payload, null, 2) + "\n",
    "utf8"
  );

  // One listing renderer, used for both the issues index and the (separate)
  // activity-logs index — same card-style title + right-aligned MD/JSON chips and
  // a "View" button at the end.
  function listing(kind) {
    const isIssues = kind === "issues";
    const items = issues.length
      ? issues
          .map((issue) => {
            const htmlHref = isIssues ? issue.links.default_html : issue.links.marketing_html;
            const mdHref = isIssues ? issue.links.default_md : issue.links.marketing_md;
            const jsonHref = isIssues ? issue.links.default_json : issue.links.marketing_json;
            const btn = isIssues ? "View issue" : "View log";
            return `
        <li>
          <div class="issue-row-head"><strong>${issue.month_label}</strong><span class="issue-tag">${issue.issue_label}</span></div>
          <div class="links">
            <a class="filechip" title="Markdown" href="../${mdHref}">MD</a>
            <a class="filechip" title="JSON" href="../${jsonHref}">JSON</a>
            <a class="btn" href="../${htmlHref}">${btn}</a>
          </div>
        </li>`;
          })
          .join("\n")
      : `<li>No ${isIssues ? "archived issues" : "activity logs"} yet.</li>`;
    const heading = isIssues ? "Issue Archive" : "Activity Logs";
    const sub = isIssues
      ? "Frozen monthly Research Roundups, preserved from approved builds."
      : "The monthly research activity log for each cycle.";
    return `<!doctype html>
<html lang="en"><head>
${docHead(`Everpure Research — ${heading}`)}
</head>
<body>
${sidebar(isIssues ? "issues" : "activity", "../")}
<div class="shell"><div class="wrap">
<header>
  <h1>${heading}</h1>
  <p class="sub">${sub}</p>
</header>
<section class="panel">
  <ul class="issuelist">${items}
  </ul>
</section>
</div></div>
</body></html>`;
  }

  ensureDir(path.join(publishDir, "issues"));
  fs.writeFileSync(path.join(publishDir, "issues", "index.html"), listing("issues"), "utf8");
  ensureDir(path.join(publishDir, "activity"));
  fs.writeFileSync(path.join(publishDir, "activity", "index.html"), listing("activity"), "utf8");
}

function main() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const publishDir = path.join(root, "publish");
  const repoIssuesDir = path.join(root, "issues");
  const repoHistoryDir = path.join(root, "history");
  const publishIssuesDir = path.join(publishDir, "issues");
  const publishHistoryDir = path.join(publishDir, "history");

  ensureDir(publishDir);
  removeDirIfExists(publishIssuesDir);
  removeDirIfExists(publishHistoryDir);

  if (exists(repoIssuesDir)) {
    copyRecursive(repoIssuesDir, publishIssuesDir);
  } else {
    ensureDir(publishIssuesDir);
  }

  if (exists(repoHistoryDir)) {
    copyRecursive(repoHistoryDir, publishHistoryDir);
  }

  buildIssuesCatalog(publishDir);

  const issueCount =
    readJson(path.join(publishDir, "data", "issues.json"), { issue_count: 0 }).issue_count || 0;
  console.log(
    JSON.stringify(
      {
        published_issue_archive: exists(repoIssuesDir),
        published_history: exists(repoHistoryDir),
        issue_count: issueCount,
        outputs: [
          path.join(publishDir, "issues", "index.html"),
          path.join(publishDir, "data", "issues.json"),
        ],
      },
      null,
      2
    )
  );
}

main();
