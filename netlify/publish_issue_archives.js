#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { docHead, sidebar } = require("./dashboard_theme");

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
  const issues = months.map((month) => {
    const manifestPath = path.join(issuesDir, month, "issue_manifest.json");
    const manifest = readJson(manifestPath, {}) || {};
    return {
      issue_id: manifest.issue_id || `everpure-${month}`,
      issue_month: month,
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

  const items = issues.length
    ? issues
        .map((issue) => {
          return `
        <li>
          <strong>${issue.issue_month}</strong>
          <span class="meta">${issue.generated_at ? `Generated ${issue.generated_at}` : ""}</span>
          <div class="links">
            <a href="../${issue.links.default_html}">Default HTML</a>
            <a href="../${issue.links.default_md}">Default MD</a>
            <a href="../${issue.links.default_json}">Default JSON</a>
            <a href="../${issue.links.marketing_html}">Marketing HTML</a>
            <a href="../${issue.links.marketing_md}">Marketing MD</a>
            <a href="../${issue.links.marketing_json}">Marketing JSON</a>
            <a href="../${issue.links.manifest}">Manifest</a>
          </div>
        </li>`;
        })
        .join("\n")
    : "<li>No archived issues yet.</li>";

  const html = `<!doctype html>
<html lang="en"><head>
${docHead("Everpure Research — Issue Archive")}
</head>
<body>
${sidebar("issues", "../")}
<div class="shell"><div class="wrap">
<header>
  <h1>Issue Archive</h1>
  <p class="sub">Frozen monthly issues and manifests preserved from approved builds.</p>
</header>
<section class="panel">
  <ul class="issuelist">${items}
  </ul>
</section>
</div></div>
</body></html>`;

  ensureDir(path.join(publishDir, "issues"));
  fs.writeFileSync(path.join(publishDir, "issues", "index.html"), html, "utf8");
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
